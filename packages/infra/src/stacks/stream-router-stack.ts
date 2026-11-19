/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  CoreTable,
  EventsAnalyticsUpdate,
  EventsEarningsRecording,
  EventsNotificationDelivery,
  EventsProgressRecalculation,
  EventsSearchIndexing,
  EventsStreamRouter,
  RuntimeConfig,
  SearchCollection,
  StreamRouter,
} from '@discava/common-constructs';
import type {
  NotificationsComponentConfig,
  PayoutSettings,
  StreamRouterComponentConfig,
} from '@discava/common-infra-config';
import { STREAM_FEATURES } from '@discava/core-table';
import { Stack, StackProps } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { Function } from 'aws-cdk-lib/aws-lambda';
import type { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { importNotificationUnsubscribeSecret } from './notification-secret.js';

export interface StreamRouterStackProps extends StackProps {
  /** Settings for the stream router's queues. @default all enabled */
  readonly streamRouter?: StreamRouterComponentConfig;
  readonly coreTable: CoreTable;
  readonly searchCollection: SearchCollection;
  /** Sender and SES identity for notification emails. @default no sender, no SES access */
  readonly notifications?: NotificationsComponentConfig;
  /** Signs the unsubscribe links the delivery function puts in each email. */
  readonly notificationUnsubscribeSecret: ISecret;
  /** The portals' addresses, which a notification's link points into. */
  readonly portalUrls: { student: string; instructor: string; admin: string };
  /** core-api's address, which the unsubscribe link points to. */
  readonly coreApiUrl: string;
  /** The stage's fee and hold, which earnings recording applies to each sale. */
  readonly payouts: Pick<PayoutSettings, 'platformFeeBasisPoints' | 'holdDays'>;
}

/**
 * The only reader of the core table's stream and everything it feeds: the
 * router Lambda, one queue (with a failure queue and an alarm) per registered
 * feature in core-table's `STREAM_FEATURES`, and the feature handlers those
 * queues invoke (progress recalculation, search indexing, analytics, earnings
 * recording and notification delivery). Kept apart from CoreApi so a feature's queues and
 * handler don't count against that stack's resource limit. Depends on Data,
 * and on Websites and CoreApi for the addresses notification emails link to.
 */
export class StreamRouterStack extends Stack {
  public readonly streamRouter: StreamRouter;

  constructor(
    scope: Construct,
    id: string,
    {
      streamRouter: streamRouterConfig,
      coreTable,
      searchCollection,
      notifications,
      notificationUnsubscribeSecret,
      portalUrls,
      coreApiUrl,
      payouts,
      ...props
    }: StreamRouterStackProps,
  ) {
    super(scope, id, props);

    const router = new EventsStreamRouter(this, 'StreamRouterFunction');
    const handlers = {
      'progress-recalculation':
        this.createProgressRecalculationLambda(coreTable),
      'search-indexing': this.createSearchIndexingLambda(
        coreTable,
        searchCollection,
      ),
      'analytics-update': this.createAnalyticsUpdateLambda(coreTable),
      'notification-delivery': this.createNotificationDeliveryLambda(
        coreTable,
        notifications,
        notificationUnsubscribeSecret,
        portalUrls,
        coreApiUrl,
      ),
      'earnings-recording': this.createEarningsRecordingLambda(
        coreTable,
        payouts,
      ),
    };

    this.streamRouter = new StreamRouter(this, 'StreamRouter', {
      table: coreTable.table,
      router,
      features: STREAM_FEATURES,
      handlers,
      enableKmsEncryption: streamRouterConfig?.enableKmsEncryption ?? true,
      enableKeyRotation: streamRouterConfig?.enableKeyRotation ?? true,
    });
  }

  // How a handler reads AppConfig: the application lives in Data, which this
  // stack depends on, so the id is a plain cross-stack reference. The
  // configuration's content is in RuntimeConfig, which deploys last and
  // depends on every stack that grants here, so no cycle appears.
  private grantAppConfig(handler: Function) {
    const runtimeConfig = RuntimeConfig.ensure(this);
    handler.addEnvironment(
      'RUNTIME_CONFIG_APP_ID',
      runtimeConfig.appConfigApplicationId,
    );
    runtimeConfig.grantReadAppConfig(handler);
  }

  // The single writer of lesson progress and of the enrolment's
  // progressPercent, status and completedAt, run from its feature's queue.
  private createProgressRecalculationLambda(coreTable: CoreTable) {
    const recalculation = new EventsProgressRecalculation(
      this,
      'ProgressRecalculation',
    );
    this.grantAppConfig(recalculation);
    coreTable.grantReadWriteData(recalculation);
    return recalculation;
  }

  // The single writer of the search collection's documents, run from its
  // feature's queue. The messages only say which courses changed: it reads
  // each one from the table to see what to index, so it can read the table
  // but never write it.
  private createSearchIndexingLambda(
    coreTable: CoreTable,
    searchCollection: SearchCollection,
  ) {
    const indexing = new EventsSearchIndexing(this, 'SearchIndexing');
    this.grantAppConfig(indexing);
    coreTable.grantReadData(indexing);
    searchCollection.grantWrite(indexing.role!);
    return indexing;
  }

  // The single writer of the instructor dashboard's analytics aggregates, run
  // from its feature's queue. It reads no other record: each change carries
  // what it adds, so it only writes the table.
  private createAnalyticsUpdateLambda(coreTable: CoreTable) {
    const analytics = new EventsAnalyticsUpdate(this, 'AnalyticsUpdate');
    this.grantAppConfig(analytics);
    coreTable.grantReadWriteData(analytics);
    return analytics;
  }

  // The single writer of the instructors' earnings ledger, run from its
  // feature's queue. It reads and writes the table and nothing else: it never
  // calls Stripe and has no grant on the Stripe secrets.
  private createEarningsRecordingLambda(
    coreTable: CoreTable,
    payouts: StreamRouterStackProps['payouts'],
  ) {
    const recording = new EventsEarningsRecording(this, 'EarningsRecording');
    this.grantAppConfig(recording);
    coreTable.grantReadWriteData(recording);
    recording.addEnvironment(
      'PLATFORM_FEE_BASIS_POINTS',
      String(payouts.platformFeeBasisPoints),
    );
    recording.addEnvironment('PAYOUT_HOLD_DAYS', String(payouts.holdDays));
    return recording;
  }

  // Fans a broadcast out to its course's students and emails each
  // notification, run from its feature's queue. It reads and writes the
  // table, signs unsubscribe links with the secret, and may send mail only
  // from the one SES identity the stage configures: with none, it gets no
  // sender and no SES access, and records each email as not-configured.
  private createNotificationDeliveryLambda(
    coreTable: CoreTable,
    notifications: NotificationsComponentConfig | undefined,
    unsubscribeSecret: ISecret,
    portalUrls: StreamRouterStackProps['portalUrls'],
    coreApiUrl: string,
  ) {
    const delivery = new EventsNotificationDelivery(
      this,
      'NotificationDelivery',
    );
    coreTable.grantReadWriteData(delivery);
    const secret = importNotificationUnsubscribeSecret(this, unsubscribeSecret);
    secret.grantRead(delivery);
    delivery.addEnvironment('UNSUBSCRIBE_SECRET_ARN', secret.secretArn);
    delivery.addEnvironment('STUDENT_PORTAL_URL', portalUrls.student);
    delivery.addEnvironment('INSTRUCTOR_PORTAL_URL', portalUrls.instructor);
    delivery.addEnvironment('ADMIN_PORTAL_URL', portalUrls.admin);
    delivery.addEnvironment('CORE_API_URL', coreApiUrl);
    if (notifications?.fromAddress) {
      delivery.addEnvironment(
        'NOTIFICATIONS_FROM_ADDRESS',
        notifications.fromAddress,
      );
    }
    if (notifications?.sesIdentity) {
      delivery.addToRolePolicy(
        new PolicyStatement({
          actions: ['ses:SendEmail'],
          resources: [
            this.formatArn({
              service: 'ses',
              resource: 'identity',
              resourceName: notifications.sesIdentity,
            }),
          ],
        }),
      );
    }
    return delivery;
  }
}
