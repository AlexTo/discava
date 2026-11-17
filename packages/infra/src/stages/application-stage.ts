/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { RuntimeConfig } from '@discava/common-constructs';
import type { StageComponents } from '@discava/common-infra-config';
import { Stack, Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CoreApiStack } from '../stacks/core-api-stack.js';
import { DataStack } from '../stacks/data-stack.js';
import { InstructorApiStack } from '../stacks/instructor-api-stack.js';
import { MediaPipelineStack } from '../stacks/media-pipeline-stack.js';
import { StreamRouterStack } from '../stacks/stream-router-stack.js';
import { WebsitesStack } from '../stacks/websites-stack.js';

/** Per-component settings (all default to fully hardened) plus the stage's env. */
export type ApplicationStageProps = StageProps & StageComponents;

/**
 * The application, split into stacks to stay well under CloudFormation's
 * 500-resource limit per stack. Deploy order follows the references:
 *
 *   Websites -> Data -> MediaPipeline -> CoreApi -> StreamRouter -> InstructorApi -> RuntimeConfig
 *
 * Data depends on Websites (Cognito callback URLs, lesson media CORS), the
 * APIs depend on both (and on MediaPipeline, which schedules their cleanups),
 * and RuntimeConfig (AppConfig content plus each
 * portal's runtime-config.json) collects values from all of them.
 * InstructorApi also depends on CoreApi only because the stage's single
 * ApiGatewayAccount (API Gateway's account-wide logging role) lands in
 * whichever API stack is created first. Data's search collection (#53) is
 * stateful like the core table, so it lives there too; CoreApi depends on it
 * for the search procedure's read access. StreamRouter holds the single
 * reader of the core table's stream, the queues it feeds and the progress
 * and search handlers behind them (the indexing Lambda's write access to the
 * collection included); it depends on Data, and on Websites and CoreApi for the
 * addresses the notification emails link to.
 */
export class ApplicationStage extends Stage {
  constructor(
    scope: Construct,
    id: string,
    {
      identity,
      coreApi,
      instructorApi,
      coreTable,
      streamRouter,
      studentPortal,
      instructorPortal,
      adminPortal,
      lessonMedia,
      publicMedia,
      search,
      notifications,
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
    const runtimeConfig = new Stack(this, 'RuntimeConfig', stackProps);

    const websites = new WebsitesStack(this, 'Websites', {
      ...stackProps,
      studentPortal,
      instructorPortal,
      adminPortal,
      runtimeConfigScope: runtimeConfig,
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
      notifications,
      notificationUnsubscribeSecret: data.notificationUnsubscribeSecret,
      portalUrls: websites.portalUrls,
      coreApiUrl: coreApiStack.apiUrl,
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
      instructorPortal: websites.instructorPortal,
    });

    // Every consumer references the AppConfig application, so it lives in
    // Data, which they all depend on; the content references values from
    // every stack, so it lives in RuntimeConfig, which depends on them all.
    RuntimeConfig.ensure(data).placeIn({
      applicationStack: data,
      configurationStack: runtimeConfig,
    });
  }
}
