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
 * whichever API stack is created first. Data's search collection (#53) is
 * stateful like the core table, so it lives there too; CoreApi depends on it
 * for the search procedure's read access and the indexing Lambda's write
 * access (its own DynamoEventSource on the core table's stream, alongside
 * progress recalculation's).
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
      publicMedia,
      search,
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

    new CoreApiStack(this, 'CoreApi', {
      ...stackProps,
      coreApi,
      identity: data.identity,
      coreTable: data.coreTable,
      searchCollection: data.searchCollection,
      lessonMediaBucket: data.lessonMediaBucket,
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

    // CoreApi's functions are granted search access above, after Data (and
    // so the collection) already exists; its data access policy needs their
    // role ARNs, so it can't live in Data (which would then depend back on
    // CoreApi, a cycle) -- RuntimeConfig, like the AppConfig content above,
    // already deploys last, depending on every stack that could grant here.
    data.searchCollection.placeAccessPolicyIn(runtimeConfig);
  }
}
