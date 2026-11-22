/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addSetting,
  CoreTable,
  EventsAnalyticsUpdate,
  EventsCaptionTranslation,
  EventsCertificateReminder,
  EventsEarningsRecording,
  EventsNotificationDelivery,
  EventsProgressRecalculation,
  EventsSearchIndexing,
  EventsStreamRouter,
  EventsTranscriptIndexing,
  EventsTranscriptReindex,
  LessonMediaBucket,
  SearchCollection,
  StreamRouter,
  suppressRules,
} from '@discava/common-constructs';
import type {
  CaptionTranslationSettings,
  NotificationsComponentConfig,
  PayoutSettings,
  StreamRouterComponentConfig,
} from '@discava/common-infra-config';
import { STREAM_FEATURES } from '@discava/core-table';
import { Duration, RemovalPolicy, Stack, StackProps, Stage } from 'aws-cdk-lib';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { SqsDestination } from 'aws-cdk-lib/aws-lambda-destinations';
import { ScheduleGroup } from 'aws-cdk-lib/aws-scheduler';
import type { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { captionTranslationSetting } from './caption-translation-settings.js';
import { importNotificationUnsubscribeSecret } from './notification-secret.js';

export interface StreamRouterStackProps extends StackProps {
  /** Settings for the stream router's queues. @default all enabled */
  readonly streamRouter?: StreamRouterComponentConfig;
  readonly coreTable: CoreTable;
  readonly searchCollection: SearchCollection;
  /** Holds the caption files the transcript indexer reads and the caption translation function reads and writes. */
  readonly lessonMediaBucket: LessonMediaBucket;
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
  /** The stage's caption translation settings. @default translation on, up to nine languages a course */
  readonly captionTranslation?: CaptionTranslationSettings;
}

/**
 * The only reader of the core table's stream and everything it feeds: the
 * router Lambda, one queue (with a failure queue and an alarm) per registered
 * feature in core-table's `STREAM_FEATURES`, and the feature handlers those
 * queues invoke (progress recalculation, search indexing, transcript indexing,
 * analytics, earnings recording and notification delivery). Kept apart from CoreApi so a feature's queues and
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
      lessonMediaBucket,
      notifications,
      notificationUnsubscribeSecret,
      portalUrls,
      coreApiUrl,
      payouts,
      captionTranslation,
      ...props
    }: StreamRouterStackProps,
  ) {
    super(scope, id, props);

    const router = new EventsStreamRouter(this, 'StreamRouterFunction');
    const reminder = this.createCertificateReminderLambda(coreTable);
    this.createTranscriptReindexLambda(
      coreTable,
      searchCollection,
      lessonMediaBucket,
    );
    const handlers = {
      'progress-recalculation': this.createProgressRecalculationLambda(
        coreTable,
        reminder,
      ),
      'search-indexing': this.createSearchIndexingLambda(
        coreTable,
        searchCollection,
      ),
      'transcript-indexing': this.createTranscriptIndexingLambda(
        coreTable,
        searchCollection,
        lessonMediaBucket,
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
      'caption-translation': this.createCaptionTranslationLambda(
        coreTable,
        lessonMediaBucket,
        captionTranslation,
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

  // The single writer of lesson progress and of the enrolment's
  // progressPercent, status and completedAt, run from its feature's queue.
  //
  // It also schedules each certificate's one reminder, so it may create
  // schedules in the reminder's group and pass the scheduler role only to
  // EventBridge Scheduler.
  private createProgressRecalculationLambda(
    coreTable: CoreTable,
    reminder: {
      scheduleGroup: ScheduleGroup;
      schedulerRole: Role;
      settings: object;
    },
  ) {
    const recalculation = new EventsProgressRecalculation(
      this,
      'ProgressRecalculation',
    );
    coreTable.grantReadWriteData(recalculation);
    coreTable.bindSettings(recalculation);
    addSetting(recalculation, 'certificates', 'Reminder', reminder.settings);
    reminder.scheduleGroup.grantWriteSchedules(recalculation);
    recalculation.addToRolePolicy(
      new PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [reminder.schedulerRole.roleArn],
        conditions: {
          StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' },
        },
      }),
    );
    return recalculation;
  }

  // Run once per certificate by a one-time schedule, three days after it is
  // issued: it reads and writes the table (the claim, then a notification) and
  // sends no email itself. The schedule group is destroyed with the stack, as
  // the transcode cleanup's is; the recalculation Lambda finds all three
  // through the runtime config.
  private createCertificateReminderLambda(coreTable: CoreTable) {
    const reminder = new EventsCertificateReminder(this, 'CertificateReminder');
    coreTable.grantReadWriteData(reminder);
    coreTable.bindSettings(reminder);

    const scheduleGroup = new ScheduleGroup(this, 'CertificateReminderGroup', {
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const schedulerRole = new Role(this, 'CertificateReminderSchedulerRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
    });
    reminder.grantInvoke(schedulerRole);

    // Invoked asynchronously by each schedule: a reminder that keeps failing
    // is kept in the queue, not dropped. The messages hold IDs only.
    const failures = new Queue(this, 'CertificateReminderFailures', {
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });
    suppressRules(
      failures,
      ['CKV_AWS_27'],
      'Encrypted with SQS-managed SSE, which this check does not recognise; KMS would need a customer managed key for Lambda to send to it',
    );
    reminder.configureAsyncInvoke({
      retryAttempts: 2,
      maxEventAge: Duration.hours(6),
      onFailure: new SqsDestination(failures),
    });

    // Not bound to the reminder itself: it never schedules a reminder, and
    // its own ARN in its environment would be a self-reference.
    const settings = {
      lambdaArn: reminder.functionArn,
      schedulerRoleArn: schedulerRole.roleArn,
      scheduleGroupName: scheduleGroup.scheduleGroupName,
    };
    return { reminder, scheduleGroup, schedulerRole, settings };
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
    coreTable.grantReadData(indexing);
    coreTable.bindSettings(indexing);
    searchCollection.grantWrite(indexing.role!);
    searchCollection.bindSettings(indexing);
    return indexing;
  }

  // The single writer of the transcripts index, run from its feature's queue.
  // The messages only say which video items changed: it reads each one, its
  // lesson and its module from the table, and the caption files from the
  // lesson media bucket, to see what to index. It reads the table and the
  // caption files and writes only the search collection.
  private createTranscriptIndexingLambda(
    coreTable: CoreTable,
    searchCollection: SearchCollection,
    lessonMediaBucket: LessonMediaBucket,
  ) {
    const indexing = new EventsTranscriptIndexing(this, 'TranscriptIndexing');
    coreTable.grantReadData(indexing);
    coreTable.bindSettings(indexing);
    searchCollection.grantWrite(indexing.role!);
    searchCollection.bindSettings(indexing);
    lessonMediaBucket.bindSettings(indexing);
    lessonMediaBucket.grantRead(indexing);
    return indexing;
  }

  // Rebuilds the transcripts index on demand, invoked by hand
  // (`reindex-transcripts`), with no event source. The indexer's grants: it
  // reads the table and the caption files and writes only the search
  // collection, under its own role because the collection's data access
  // policy names Lambda roles only.
  private createTranscriptReindexLambda(
    coreTable: CoreTable,
    searchCollection: SearchCollection,
    lessonMediaBucket: LessonMediaBucket,
  ) {
    const reindex = new EventsTranscriptReindex(this, 'TranscriptReindex');
    coreTable.grantReadData(reindex);
    coreTable.bindSettings(reindex);
    searchCollection.grantWrite(reindex.role!);
    searchCollection.bindSettings(reindex);
    lessonMediaBucket.bindSettings(reindex);
    lessonMediaBucket.grantRead(reindex);
    return reindex;
  }

  // The single writer of the instructor dashboard's analytics aggregates, run
  // from its feature's queue. It reads no other record: each change carries
  // what it adds, so it only writes the table.
  private createAnalyticsUpdateLambda(coreTable: CoreTable) {
    const analytics = new EventsAnalyticsUpdate(this, 'AnalyticsUpdate');
    coreTable.grantReadWriteData(analytics);
    coreTable.bindSettings(analytics);
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
    coreTable.grantReadWriteData(recording);
    coreTable.bindSettings(recording);
    recording.addEnvironment(
      'PLATFORM_FEE_BASIS_POINTS',
      String(payouts.platformFeeBasisPoints),
    );
    recording.addEnvironment('PAYOUT_HOLD_DAYS', String(payouts.holdDays));
    return recording;
  }

  // Translates each video's default caption track into its course's caption
  // languages, run from its feature's queue. It reads and writes the table, and
  // reads, puts and deletes caption files under the captions folders only: it
  // never touches a video, a transcode or a transcription.
  private createCaptionTranslationLambda(
    coreTable: CoreTable,
    lessonMediaBucket: LessonMediaBucket,
    captionTranslation: CaptionTranslationSettings | undefined,
  ) {
    const translation = new EventsCaptionTranslation(
      this,
      'CaptionTranslation',
    );
    coreTable.grantReadWriteData(translation);
    coreTable.bindSettings(translation);
    lessonMediaBucket.bindSettings(translation);
    addSetting(
      translation,
      'captionTranslation',
      'Settings',
      captionTranslationSetting(captionTranslation),
    );
    // A caption file's key is courses/<id>/.../<nonce>/captions/<track>.vtt;
    // IAM's * spans slashes.
    const captionFiles = 'courses/*/captions/*';
    lessonMediaBucket.grantRead(translation, captionFiles);
    lessonMediaBucket.grantPut(translation, captionFiles);
    lessonMediaBucket.grantDelete(translation, captionFiles);
    translation.addToRolePolicy(
      new PolicyStatement({
        actions: ['translate:TranslateText'],
        // TranslateText names no resource to scope to.
        resources: ['*'],
      }),
    );
    translation.addEnvironment(
      'STAGE_NAME',
      Stage.of(this)?.stageName ?? 'unknown',
    );
    return translation;
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
    coreTable.bindSettings(delivery);
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
    if (notifications?.sesIdentity && notifications.fromAddress) {
      // SES authorises a send against the sender's identity and, while the
      // account is in the SES sandbox, against each recipient's verified
      // identity too, so the grant covers every identity in the account and
      // the condition pins the sender to the configured address.
      delivery.addToRolePolicy(
        new PolicyStatement({
          actions: ['ses:SendEmail'],
          resources: [
            this.formatArn({
              service: 'ses',
              resource: 'identity',
              resourceName: '*',
            }),
          ],
          conditions: {
            StringEquals: { 'ses:FromAddress': notifications.fromAddress },
          },
        }),
      );
    }
    return delivery;
  }
}
