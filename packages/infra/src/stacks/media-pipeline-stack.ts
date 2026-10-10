/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  CoreTable,
  EventsTranscodeCleanup,
  EventsTranscodeComplete,
  LessonMediaBucket,
  LessonMediaUploadBucket,
  RuntimeConfig,
  suppressRules,
  VideoTranscodePipeline,
} from '@discava/common-constructs';
import { CfnResource, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import {
  IGrantable,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import { Function as LambdaFunctionHandler } from 'aws-cdk-lib/aws-lambda';
import { ScheduleGroup } from 'aws-cdk-lib/aws-scheduler';
import { Construct } from 'constructs';

export interface MediaPipelineStackProps extends StackProps {
  readonly coreTable: CoreTable;
  readonly lessonMediaBucket: LessonMediaBucket;
  readonly lessonMediaUploadBucket: LessonMediaUploadBucket;
}

/**
 * Video transcoding: the MediaConvert pipeline plus the event handlers that
 * react to its jobs (TranscodeComplete) and clean up after canceled ones
 * (TranscodeCleanup). instructor-api submits and cancels the jobs; use
 * grantSubmitTranscodeJob/grantCancelTranscodeJob for its handlers.
 */
export class MediaPipelineStack extends Stack {
  public readonly videoTranscodePipeline: VideoTranscodePipeline;
  private readonly scheduleGroup: ScheduleGroup;
  private readonly schedulerRole: Role;

  constructor(
    scope: Construct,
    id: string,
    {
      coreTable,
      lessonMediaBucket,
      lessonMediaUploadBucket,
      ...props
    }: MediaPipelineStackProps,
  ) {
    super(scope, id, props);

    this.videoTranscodePipeline = new VideoTranscodePipeline(
      this,
      'VideoTranscodePipeline',
      {
        uploadBucket: lessonMediaUploadBucket,
        mediaBucket: lessonMediaBucket,
      },
    );

    const { scheduleGroup, schedulerRole } =
      this.createTranscodeCleanupLambda(lessonMediaBucket);
    this.scheduleGroup = scheduleGroup;
    this.schedulerRole = schedulerRole;

    this.createTranscodeCompleteLambda(lessonMediaUploadBucket, coreTable);
  }

  // createContentItemVideo/updateContentItemVideo submit the MediaConvert
  // job themselves (see
  // packages/apis/instructor-api/src/lib/mediaconvert-client.ts). Both
  // handlers already get RUNTIME_CONFIG_APP_ID/AppConfig read access from
  // InstructorApi.defaultIntegrations, so only the MediaConvert-specific
  // permissions are needed here.
  public grantSubmitTranscodeJob(handler: LambdaFunctionHandler) {
    // MediaConvert's CreateJob isn't meaningfully resource-scoped for a
    // submitter role (the job doesn't exist yet), so this is the widest
    // permission in this stage that's still limited to one action.
    handler.addToRolePolicy(
      new PolicyStatement({
        actions: ['mediaconvert:CreateJob'],
        resources: ['*'],
      }),
    );
    suppressRules(
      handler,
      ['CKV_AWS_111'],
      'CreateJob has no meaningful resource to scope to before the job exists; narrowed to just this one action instead',
      (c) =>
        CfnResource.isCfnResource(c) &&
        c.cfnResourceType === 'AWS::IAM::Policy',
    );
    handler.addToRolePolicy(
      new PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [this.videoTranscodePipeline.role.roleArn],
      }),
    );
  }

  // Replacing or deleting a still-transcoding video cancels its job (see
  // #123 and the delete-mid-transcode follow-up) -- unlike CreateJob, a job
  // to cancel already exists here, so this can be scoped to the resource
  // type instead of needing a suppression. Every caller of
  // bestEffortCancelTranscodeJob(s) also schedules that job's delayed S3
  // cleanup, so both grants go together.
  public grantCancelTranscodeJob(handler: LambdaFunctionHandler) {
    handler.addToRolePolicy(
      new PolicyStatement({
        actions: ['mediaconvert:CancelJob'],
        resources: [
          Stack.of(this).formatArn({
            service: 'mediaconvert',
            resource: 'jobs',
            resourceName: '*',
          }),
        ],
      }),
    );
    this.grantScheduleCleanupWrite(handler);
  }

  // Grants permission to create/update a one-time cleanup schedule in
  // scheduleGroup, targeting schedulerRole -- shared by every handler that
  // can end up retiring a submission's nonce-scoped S3 output, whether by
  // canceling its job early (bestEffortCancelTranscodeJob) or, lacking a
  // job id to cancel with, reacting to that job's own completion event
  // once it finishes on its own (transcode-complete.ts).
  private grantScheduleCleanupWrite(handler: IGrantable) {
    this.scheduleGroup.grantWriteSchedules(handler);
    // Creating a schedule with a target role requires the creator to be
    // allowed to pass that role -- scoped to just this one role, and only
    // for EventBridge Scheduler to assume, not any service.
    handler.grantPrincipal.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [this.schedulerRole.roleArn],
        conditions: {
          StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' },
        },
      }),
    );
  }

  private createTranscodeCompleteLambda(
    lessonMediaUploadBucket: LessonMediaUploadBucket,
    coreTable: CoreTable,
  ) {
    // MediaConvert job COMPLETE/ERROR via EventBridge -> flip contentItem
    // status and, on success, repoint s3Key and clean up the raw upload.
    const transcodeComplete = new EventsTranscodeComplete(
      this,
      'TranscodeComplete',
    );
    // The upload bucket's name is resolved at runtime via RuntimeConfig/
    // AppConfig, granted below alongside the DynamoDB table name lookup
    // @discava/core-table already needs.
    const runtimeConfig = RuntimeConfig.ensure(this);
    transcodeComplete.addEnvironment(
      'RUNTIME_CONFIG_APP_ID',
      runtimeConfig.appConfigApplicationId,
    );
    runtimeConfig.grantReadAppConfig(transcodeComplete);
    coreTable.grantReadWriteData(transcodeComplete);
    lessonMediaUploadBucket.grantDelete(transcodeComplete);
    // A submission whose mediaConvertJobId was never stamped can't be
    // canceled/scheduled early by whatever delete/replace call retired it
    // (see mediaconvert-client.ts's bestEffortCancelTranscodeJobs) --
    // transcode-complete.ts schedules that cleanup itself once this job's
    // own completion event arrives, so it needs the same grants every
    // other scheduler of that cleanup already has.
    this.grantScheduleCleanupWrite(transcodeComplete);
    new Rule(this, 'TranscodeCompleteRule', {
      eventPattern: {
        source: ['aws.mediaconvert'],
        detailType: ['MediaConvert Job State Change'],
        detail: { status: ['COMPLETE', 'ERROR'] },
      },
      targets: [new LambdaFunction(transcodeComplete)],
    });

    return transcodeComplete;
  }

  // bestEffortCancelTranscodeJob schedules a one-time, delayed invocation
  // of this Lambda for the exact job it just canceled (see
  // mediaconvert-client.ts) -- invoked directly by EventBridge Scheduler,
  // not via a persistent Rule like TranscodeComplete, since each
  // invocation is its own one-off event rather than a recurring pattern.
  private createTranscodeCleanupLambda(lessonMediaBucket: LessonMediaBucket) {
    const transcodeCleanup = new EventsTranscodeCleanup(
      this,
      'TranscodeCleanup',
    );
    const runtimeConfig = RuntimeConfig.ensure(this);
    transcodeCleanup.addEnvironment(
      'RUNTIME_CONFIG_APP_ID',
      runtimeConfig.appConfigApplicationId,
    );
    runtimeConfig.grantReadAppConfig(transcodeCleanup);
    // Needs both: list the job's own nonce-scoped prefix, then delete
    // everything found there.
    lessonMediaBucket.grantRead(transcodeCleanup);
    lessonMediaBucket.grantDelete(transcodeCleanup);

    // A dedicated group (rather than the account's default one) so the
    // scheduler:CreateSchedule/UpdateSchedule grant can be scoped to just
    // these schedules instead of every schedule in the account.
    // Destroyed with the stack: CDK names the group deterministically, so a
    // retained group blocks the stack from ever being created again, and its
    // one-time schedules are only meaningful while the stack exists.
    const scheduleGroup = new ScheduleGroup(this, 'TranscodeCleanupGroup', {
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // EventBridge Scheduler assumes this to invoke the cleanup Lambda on
    // each schedule's behalf -- distinct from the instructor-api handlers'
    // own role, which only needs to create the schedule, not run it.
    const schedulerRole = new Role(this, 'TranscodeCleanupSchedulerRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
    });
    transcodeCleanup.grantInvoke(schedulerRole);

    runtimeConfig.set('mediaConvert', 'TranscodeCleanup', {
      lambdaArn: transcodeCleanup.functionArn,
      schedulerRoleArn: schedulerRole.roleArn,
      scheduleGroupName: scheduleGroup.scheduleGroupName,
    });

    return { transcodeCleanup, scheduleGroup, schedulerRole };
  }
}
