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
import { WebsitesStack } from '../stacks/websites-stack.js';

/** Per-component settings (all default to fully hardened) plus the stage's env. */
export type ApplicationStageProps = StageProps & StageComponents;

/**
 * The application, split into stacks to stay well under CloudFormation's
 * 500-resource limit per stack. Deploy order follows the references:
 *
 *   Websites -> Data -> CoreApi -------> InstructorApi -> RuntimeConfig
 *                    \-> MediaPipeline -/
 *
 * Data depends on Websites (Cognito callback URLs, lesson media CORS), the
 * APIs depend on both, and RuntimeConfig (AppConfig content plus each
 * portal's runtime-config.json) collects values from all of them.
 * InstructorApi also depends on CoreApi only because the stage's single
 * ApiGatewayAccount (API Gateway's account-wide logging role) lands in
 * whichever API stack is created first.
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
      studentPortal,
      instructorPortal,
      adminPortal,
      lessonMedia,
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
      instructorPortal: websites.instructorPortal,
    });

    const mediaPipeline = new MediaPipelineStack(this, 'MediaPipeline', {
      ...stackProps,
      coreTable: data.coreTable,
      lessonMediaBucket: data.lessonMediaBucket,
      lessonMediaUploadBucket: data.lessonMediaUploadBucket,
    });

    new CoreApiStack(this, 'CoreApi', {
      ...stackProps,
      coreApi,
      identity: data.identity,
      coreTable: data.coreTable,
      portals: [
        websites.studentPortal,
        websites.instructorPortal,
        websites.adminPortal,
      ],
    });

    new InstructorApiStack(this, 'InstructorApi', {
      ...stackProps,
      instructorApi,
      identity: data.identity,
      coreTable: data.coreTable,
      lessonMediaBucket: data.lessonMediaBucket,
      lessonMediaUploadBucket: data.lessonMediaUploadBucket,
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
