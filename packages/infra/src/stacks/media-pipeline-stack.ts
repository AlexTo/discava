/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  CoreTable,
  EventsTranscodeCleanup,
  EventsTranscodeComplete,
  EventsTranscodeReconciler,
  LessonMediaBucket,
  LessonMediaUploadBucket,
  RuntimeConfig,
  suppressRules,
  VideoTranscodePipeline,
} from '@discava/common-constructs';
import {
  CfnResource,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import {
  IGrantable,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import { Function as LambdaFunctionHandler } from 'aws-cdk-lib/aws-lambda';
import { SqsDestination } from 'aws-cdk-lib/aws-lambda-destinations';
import { ScheduleGroup } from 'aws-cdk-lib/aws-scheduler';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
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
    this.createTranscodeReconcilerLambda(lessonMediaUploadBucket, coreTable);
  }

  // Where an event a handler kept failing on is kept, instead of being
  // dropped once Lambda's retries run out (#185): the original event, the
  // error and how many attempts were made, for 14 days. SQS-managed
  // encryption, because EventBridge can't send to a queue encrypted with the
  // AWS managed KMS key; the messages hold IDs and S3 keys, nothing personal.
  private failureQueue(id: string) {
    const queue = new Queue(this, id, {
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });
    suppressRules(
      queue,
      ['CKV_AWS_27'],
      'Encrypted with SQS-managed SSE, which this check does not recognise; KMS would need a customer managed key for EventBridge to send to it',
    );
    return queue;
  }

  // What applying a finished transcode needs (see the events package's
  // applyTranscodeOutcome), shared by transcode-complete and the reconciler:
  // the table, deleting the raw upload, and scheduling a retired version's
  // or superseded job's output for cleanup.
  private grantApplyTranscodeOutcome(
    handler: LambdaFunctionHandler,
    lessonMediaUploadBucket: LessonMediaUploadBucket,
    coreTable: CoreTable,
  ) {
    // The upload bucket's name is resolved at runtime via RuntimeConfig/
    // AppConfig, granted below alongside the DynamoDB table name lookup
    // @discava/core-table already needs.
    const runtimeConfig = RuntimeConfig.ensure(this);
    handler.addEnvironment(
      'RUNTIME_CONFIG_APP_ID',
      runtimeConfig.appConfigApplicationId,
    );
    runtimeConfig.grantReadAppConfig(handler);
    coreTable.grantReadWriteData(handler);
    lessonMediaUploadBucket.grantDelete(handler);
    // A submission whose mediaConvertJobId was never stamped can't be
    // canceled/scheduled early by whatever delete/replace call retired it
    // (see mediaconvert-client.ts's bestEffortCancelTranscodeJobs) --
    // applying its outcome schedules that cleanup itself, so it needs the
    // same grants every other scheduler of that cleanup already has.
    this.grantScheduleCleanupWrite(handler);
  }

  // Settles lesson videos stuck waiting for a transcode (#125): a completion
  // event that never arrived or kept failing, or a video that never got a
  // job. Every 30 minutes; a run with nothing stuck is one empty query.
  private createTranscodeReconcilerLambda(
    lessonMediaUploadBucket: LessonMediaUploadBucket,
    coreTable: CoreTable,
  ) {
    const reconciler = new EventsTranscodeReconciler(
      this,
      'TranscodeReconciler',
    );
    this.grantApplyTranscodeOutcome(
      reconciler,
      lessonMediaUploadBucket,
      coreTable,
    );
    // Asks MediaConvert how a stuck video's job ended.
    reconciler.addToRolePolicy(
      new PolicyStatement({
        actions: ['mediaconvert:GetJob'],
        resources: [
          this.formatArn({
            service: 'mediaconvert',
            resource: 'jobs',
            resourceName: '*',
          }),
        ],
      }),
    );
    new Rule(this, 'TranscodeReconcilerSchedule', {
      schedule: Schedule.rate(Duration.minutes(30)),
      targets: [new LambdaFunction(reconciler)],
    });
    return reconciler;
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

  // For a handler that only retires lesson media (e.g. a replaced file item's
  // old version, #102), without submitting or cancelling transcode jobs.
  public grantScheduleCleanup(handler: LambdaFunctionHandler) {
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
    this.grantApplyTranscodeOutcome(
      transcodeComplete,
      lessonMediaUploadBucket,
      coreTable,
    );

    // EventBridge invokes it asynchronously: once it has accepted an event,
    // Lambda's own retries apply, then the event is kept in the failure
    // queue rather than dropped (#185). The reconciler settles the video
    // meanwhile; the queue keeps what went wrong.
    const failures = this.failureQueue('TranscodeCompleteFailures');
    transcodeComplete.configureAsyncInvoke({
      retryAttempts: 2,
      maxEventAge: Duration.hours(6),
      onFailure: new SqsDestination(failures),
    });
    new Rule(this, 'TranscodeCompleteRule', {
      eventPattern: {
        source: ['aws.mediaconvert'],
        detailType: ['MediaConvert Job State Change'],
        detail: { status: ['COMPLETE', 'ERROR'] },
      },
      // Events EventBridge couldn't deliver at all go to the same queue.
      targets: [
        new LambdaFunction(transcodeComplete, {
          deadLetterQueue: failures,
          retryAttempts: 8,
          maxEventAge: Duration.hours(6),
        }),
      ],
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
    // Invoked asynchronously by each schedule: a cleanup that keeps failing
    // is kept, not dropped (#185). Only leaves files behind if it's never
    // replayed; deleting an already-deleted prefix is a no-op.
    transcodeCleanup.configureAsyncInvoke({
      retryAttempts: 2,
      maxEventAge: Duration.hours(6),
      onFailure: new SqsDestination(
        this.failureQueue('TranscodeCleanupFailures'),
      ),
    });

    runtimeConfig.set('mediaConvert', 'TranscodeCleanup', {
      lambdaArn: transcodeCleanup.functionArn,
      schedulerRoleArn: schedulerRole.roleArn,
      scheduleGroupName: scheduleGroup.scheduleGroupName,
    });

    return { transcodeCleanup, scheduleGroup, schedulerRole };
  }
}
