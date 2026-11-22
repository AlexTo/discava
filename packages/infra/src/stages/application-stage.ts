/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  CaptionTranslationSettings,
  PayoutSettings,
  StageComponents,
} from '@discava/common-infra-config';
import { Stack, Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AdminApiStack } from '../stacks/admin-api-stack.js';
import { CoreApiStack } from '../stacks/core-api-stack.js';
import { DataStack } from '../stacks/data-stack.js';
import { InstructorApiStack } from '../stacks/instructor-api-stack.js';
import { MediaPipelineStack } from '../stacks/media-pipeline-stack.js';
import { PaymentsStack } from '../stacks/payments-stack.js';
import { PayoutsStack } from '../stacks/payouts-stack.js';
import { StreamRouterStack } from '../stacks/stream-router-stack.js';
import { WebsitesStack } from '../stacks/websites-stack.js';

/** Per-component settings (all default to fully hardened) plus the stage's env. */
export type ApplicationStageProps = StageProps &
  StageComponents & {
    /** The stage's payout settings. @default the documented defaults (2000 basis points, 14 days, a minimum of 1000) */
    payouts?: Pick<PayoutSettings, 'platformFeeBasisPoints' | 'holdDays'> &
      Partial<Pick<PayoutSettings, 'minimumPayoutMinor'>>;
    /** The stage's caption translation settings. @default translation on, up to nine languages a course */
    captionTranslation?: CaptionTranslationSettings;
  };

/**
 * The application, split into stacks to stay well under CloudFormation's
 * 500-resource limit per stack. Deploy order follows the references:
 *
 *   Websites -> Data -> Payments -> MediaPipeline -> CoreApi -> StreamRouter -> Payouts -> InstructorApi -> AdminApi -> PortalConfig
 *
 * Data (users, the core table, media buckets, the search collection and the
 * secrets) depends on Websites for Cognito callback URLs and lesson media
 * CORS. Payments holds the Stripe webhook API, which only needs the table and
 * the Stripe secrets from Data. The APIs depend on both Websites and Data, and
 * CoreApi and InstructorApi on MediaPipeline (transcodes and scheduled
 * cleanups). AdminApi depends on Payments for the webhook's address.
 * InstructorApi and AdminApi also depend on CoreApi, only because the stage's
 * single ApiGatewayAccount (API Gateway's account-wide logging role) lands in
 * whichever API stack is created first. StreamRouter holds the single reader
 * of the core table's stream, the queues it feeds and the handlers behind
 * them; it depends on Data, and on Websites and CoreApi for the addresses
 * notification emails link to. Payouts holds the daily payout run, which only needs the table and the
 * API key from Data. PortalConfig (each portal's
 * runtime-config.json) collects values from all of them.
 */
export class ApplicationStage extends Stage {
  constructor(
    scope: Construct,
    id: string,
    {
      identity,
      coreApi,
      instructorApi,
      adminApi,
      payments,
      coreTable,
      streamRouter,
      studentPortal,
      instructorPortal,
      adminPortal,
      lessonMedia,
      publicMedia,
      search,
      notifications,
      payouts = { platformFeeBasisPoints: 2000, holdDays: 14 },
      captionTranslation,
      ...props
    }: ApplicationStageProps,
  ) {
    super(scope, id, props);

    // Lets a stack reference the portals' and lesson media's us-east-1 WAF
    // stacks, and anything else outside its own region.
    const stackProps = { crossRegionReferences: true };

    // Created first so the portals can put their runtime-config.json
    // deployments in it; it still deploys last, since it depends on
    // everything it reads from.
    const portalConfig = new Stack(this, 'PortalConfig', stackProps);

    const websites = new WebsitesStack(this, 'Websites', {
      ...stackProps,
      studentPortal,
      instructorPortal,
      adminPortal,
      portalConfigScope: portalConfig,
    });

    const data = new DataStack(this, 'Data', {
      ...stackProps,
      identity,
      coreTable,
      lessonMedia,
      publicMedia,
      search,
      instructorPortal: websites.instructorPortal,
      studentPortal: websites.studentPortal,
    });

    const paymentsStack = new PaymentsStack(this, 'Payments', {
      ...stackProps,
      payments,
      coreTable: data.coreTable,
      stripeSecrets: data.stripeSecrets,
    });

    const mediaPipeline = new MediaPipelineStack(this, 'MediaPipeline', {
      ...stackProps,
      coreTable: data.coreTable,
      lessonMediaBucket: data.lessonMediaBucket,
      lessonMediaUploadBucket: data.lessonMediaUploadBucket,
    });

    const coreApiStack = new CoreApiStack(this, 'CoreApi', {
      ...stackProps,
      coreApi,
      identity: data.identity,
      coreTable: data.coreTable,
      searchCollection: data.searchCollection,
      stripeSecrets: data.stripeSecrets,
      notificationUnsubscribeSecret: data.notificationUnsubscribeSecret,
      lessonMediaBucket: data.lessonMediaBucket,
      lessonMediaUploadBucket: data.lessonMediaUploadBucket,
      mediaPipeline,
      studentPortalUrl: websites.portalUrls.student,
      portals: [
        websites.studentPortal,
        websites.instructorPortal,
        websites.adminPortal,
      ],
    });

    new StreamRouterStack(this, 'StreamRouter', {
      ...stackProps,
      streamRouter,
      coreTable: data.coreTable,
      searchCollection: data.searchCollection,
      lessonMediaBucket: data.lessonMediaBucket,
      publicMediaBucket: data.publicMediaBucket,
      notifications,
      notificationUnsubscribeSecret: data.notificationUnsubscribeSecret,
      portalUrls: websites.portalUrls,
      coreApiUrl: coreApiStack.apiUrl,
      payouts,
      captionTranslation,
    });

    new PayoutsStack(this, 'Payouts', {
      ...stackProps,
      coreTable: data.coreTable,
      stripeSecrets: data.stripeSecrets,
      minimumPayoutMinor: payouts.minimumPayoutMinor ?? 1000,
    });

    new InstructorApiStack(this, 'InstructorApi', {
      ...stackProps,
      instructorApi,
      identity: data.identity,
      coreTable: data.coreTable,
      lessonMediaBucket: data.lessonMediaBucket,
      lessonMediaUploadBucket: data.lessonMediaUploadBucket,
      publicMediaBucket: data.publicMediaBucket,
      mediaPipeline,
      stripeSecrets: data.stripeSecrets,
      instructorPortal: websites.instructorPortal,
      captionTranslation,
    });

    new AdminApiStack(this, 'AdminApi', {
      ...stackProps,
      adminApi,
      identity: data.identity,
      coreTable: data.coreTable,
      publicMediaBucket: data.publicMediaBucket,
      stripeSecrets: data.stripeSecrets,
      webhookUrl: paymentsStack.webhookUrl,
      adminPortal: websites.adminPortal,
    });

    // Last to deploy, so every value a portal's runtime-config.json reads
    // exists by then, whether or not the file reads from that stack.
    for (const stack of this.node.children) {
      if (stack instanceof Stack && stack !== portalConfig) {
        portalConfig.addDependency(stack);
      }
    }
  }
}
