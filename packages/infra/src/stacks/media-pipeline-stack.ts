/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addSetting,
  CoreTable,
  EventsTranscodeCleanup,
  EventsTranscodeComplete,
  EventsTranscodeReconciler,
  EventsTranscribeComplete,
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
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Function as LambdaFunctionHandler } from 'aws-cdk-lib/aws-lambda';
import { SqsDestination } from 'aws-cdk-lib/aws-lambda-destinations';
import { ScheduleGroup } from 'aws-cdk-lib/aws-scheduler';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

// Keys in the lesson media bucket (see server-utils' captions.ts): where
// Transcribe writes, outside the folder students' cookies authorise, and where
// the finished tracks live inside it.
const TRANSCRIBE_OUTPUT_PATTERN = 'courses/*/transcribe-output/*';
const CAPTIONS_PATTERN = 'courses/*/captions/*';

export interface MediaPipelineStackProps extends StackProps {
  readonly coreTable: CoreTable;
  readonly lessonMediaBucket: LessonMediaBucket;
  readonly lessonMediaUploadBucket: LessonMediaUploadBucket;
}

/**
 * Video transcoding and automatic captions: the MediaConvert pipeline, the
 * handlers that apply a job's outcome (TranscodeComplete, and
 * TranscodeReconciler for stuck videos), TranscribeComplete, and
 * TranscodeCleanup, which one-time schedules invoke to delete retired media.
 * The APIs' handlers get their rights through grantSubmitTranscodeJob,
 * grantCancelTranscodeJob and grantScheduleCleanup.
 */
export class MediaPipelineStack extends Stack {
  public readonly videoTranscodePipeline: VideoTranscodePipeline;
  private readonly scheduleGroup: ScheduleGroup;
  private readonly schedulerRole: Role;
  private readonly cleanupSettings: {
    lambdaArn: string;
    schedulerRoleArn: string;
    scheduleGroupName: string;
  };

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

    const { scheduleGroup, schedulerRole, cleanupSettings } =
      this.createTranscodeCleanupLambda(lessonMediaBucket, coreTable);
    this.scheduleGroup = scheduleGroup;
    this.schedulerRole = schedulerRole;
    this.cleanupSettings = cleanupSettings;

    this.createTranscodeCompleteLambda(
      lessonMediaBucket,
      lessonMediaUploadBucket,
      coreTable,
    );
    this.createTranscodeReconcilerLambda(
      lessonMediaBucket,
      lessonMediaUploadBucket,
      coreTable,
    );
    this.createTranscribeCompleteLambda(lessonMediaBucket, coreTable);
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
    lessonMediaBucket: LessonMediaBucket,
    lessonMediaUploadBucket: LessonMediaUploadBucket,
    coreTable: CoreTable,
  ) {
    coreTable.grantReadWriteData(handler);
    coreTable.bindSettings(handler);
    // The buckets' names are deploy-time settings: the upload bucket's to
    // delete the raw upload, and both to start the version's captions.
    lessonMediaUploadBucket.bindSettings(handler);
    lessonMediaBucket.bindSettings(handler);
    lessonMediaUploadBucket.grantDelete(handler);
    // A submission whose mediaConvertJobId was never stamped can't be
    // canceled/scheduled early by whatever delete/replace call retired it
    // (see mediaconvert-client.ts's bestEffortCancelTranscodeJobs) --
    // applying its outcome schedules that cleanup itself, so it needs the
    // same grants every other scheduler of that cleanup already has.
    this.grantScheduleCleanupWrite(handler);

    // Starting the version's automatic captions (best effort). Transcribe
    // reads the audio file and writes its outputs with the caller's own
    // credentials, so the Lambda needs the S3 and KMS access itself: read of
    // the audio file, and write to the scratch prefix only, never the
    // captions prefix.
    handler.addToRolePolicy(
      new PolicyStatement({
        actions: ['transcribe:StartTranscriptionJob', 'transcribe:TagResource'],
        resources: [
          this.formatArn({
            service: 'transcribe',
            resource: 'transcription-job',
            resourceName: '*',
          }),
        ],
      }),
    );
    lessonMediaUploadBucket.grantRead(handler, 'transcribe-input/*');
    lessonMediaBucket.grantPut(handler, TRANSCRIBE_OUTPUT_PATTERN);
  }

  // Settles lesson videos stuck waiting for a transcode (#125): a completion
  // event that never arrived or kept failing, or a video that never got a
  // job. Every 30 minutes; a run with nothing stuck is one empty query.
  private createTranscodeReconcilerLambda(
    lessonMediaBucket: LessonMediaBucket,
    lessonMediaUploadBucket: LessonMediaUploadBucket,
    coreTable: CoreTable,
  ) {
    const reconciler = new EventsTranscodeReconciler(
      this,
      'TranscodeReconciler',
    );
    this.grantApplyTranscodeOutcome(
      reconciler,
      lessonMediaBucket,
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

  // instructor-api's video procedures submit the MediaConvert job themselves
  // (packages/apis/instructor-api/src/helpers/mediaconvert-client.ts).
  // The caller binds the buckets' settings; the pipeline's role and job
  // template come with the MediaConvert permissions added here.
  public grantSubmitTranscodeJob(handler: LambdaFunctionHandler) {
    this.videoTranscodePipeline.bindSettings(handler);
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

  // Replacing or deleting a still-transcoding video cancels its job (#123).
  // Unlike CreateJob, the job already exists, so this is scoped to the jobs
  // resource type with no suppression. Every caller of
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

  // Lets a handler create or update a one-time cleanup schedule in
  // scheduleGroup that targets schedulerRole: every handler that can retire
  // lesson media, whether by canceling a job, replacing a version, or
  // applying a finished job's outcome.
  private grantScheduleCleanupWrite(handler: LambdaFunctionHandler) {
    addSetting(
      handler,
      'mediaConvert',
      'TranscodeCleanup',
      this.cleanupSettings,
    );
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
    lessonMediaBucket: LessonMediaBucket,
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
      lessonMediaBucket,
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

  // Transcribe job COMPLETED/FAILED via EventBridge -> the version's caption
  // track (see the events package's transcribe-complete). Same failure
  // handling as TranscodeComplete.
  private createTranscribeCompleteLambda(
    lessonMediaBucket: LessonMediaBucket,
    coreTable: CoreTable,
  ) {
    const transcribeComplete = new EventsTranscribeComplete(
      this,
      'TranscribeComplete',
    );
    coreTable.grantReadWriteData(transcribeComplete);
    coreTable.bindSettings(transcribeComplete);
    lessonMediaBucket.bindSettings(transcribeComplete);
    // The job's tags and the location of its WebVTT.
    transcribeComplete.addToRolePolicy(
      new PolicyStatement({
        actions: ['transcribe:GetTranscriptionJob'],
        resources: [
          this.formatArn({
            service: 'transcribe',
            resource: 'transcription-job',
            resourceName: '*',
          }),
        ],
      }),
    );
    // Reads the WebVTT from the scratch prefix, deletes what Transcribe wrote
    // there and writes the track under the version's captions folder.
    lessonMediaBucket.grantRead(transcribeComplete, TRANSCRIBE_OUTPUT_PATTERN);
    lessonMediaBucket.grantDelete(
      transcribeComplete,
      TRANSCRIBE_OUTPUT_PATTERN,
    );
    lessonMediaBucket.grantPut(transcribeComplete, CAPTIONS_PATTERN);

    const failures = this.failureQueue('TranscribeCompleteFailures');
    transcribeComplete.configureAsyncInvoke({
      retryAttempts: 2,
      maxEventAge: Duration.hours(6),
      onFailure: new SqsDestination(failures),
    });
    new Rule(this, 'TranscribeCompleteRule', {
      eventPattern: {
        source: ['aws.transcribe'],
        detailType: ['Transcribe Job State Change'],
        detail: { TranscriptionJobStatus: ['COMPLETED', 'FAILED'] },
      },
      targets: [
        new LambdaFunction(transcribeComplete, {
          deadLetterQueue: failures,
          retryAttempts: 8,
          maxEventAge: Duration.hours(6),
        }),
      ],
    });

    return transcribeComplete;
  }

  // Invoked directly by EventBridge Scheduler, one one-time schedule per
  // cleanup (a canceled job's output, a retired version, a student's
  // submission folder), rather than by a Rule like TranscodeComplete.
  private createTranscodeCleanupLambda(
    lessonMediaBucket: LessonMediaBucket,
    coreTable: CoreTable,
  ) {
    const transcodeCleanup = new EventsTranscodeCleanup(
      this,
      'TranscodeCleanup',
    );
    const runtimeConfig = RuntimeConfig.ensure(this);
    lessonMediaBucket.bindSettings(transcodeCleanup);
    // Needs both: list the job's own nonce-scoped prefix, then delete
    // everything found there.
    lessonMediaBucket.grantRead(transcodeCleanup);
    lessonMediaBucket.grantDelete(transcodeCleanup);
    // A student's submission folder is only deleted when no submission holds
    // its file (#102): read-only, to check.
    coreTable.grantReadData(transcodeCleanup);
    coreTable.bindSettings(transcodeCleanup);

    // A dedicated group (rather than the account's default one) so the
    // scheduler:CreateSchedule/UpdateSchedule grant can be scoped to just
    // these schedules instead of every schedule in the account.
    // Destroyed with the stack: CDK names the group deterministically, so a
    // retained group blocks the stack from ever being created again, and its
    // one-time schedules are only meaningful while the stack exists.
    const scheduleGroup = new ScheduleGroup(this, 'TranscodeCleanupGroup', {
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // EventBridge Scheduler assumes this to invoke the cleanup Lambda;
    // the handlers that create schedules only pass it, never run them.
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

    // Not bound to transcodeCleanup itself: it never schedules a cleanup, and
    // its own ARN in its environment would be a self-reference.
    const cleanupSettings = {
      lambdaArn: transcodeCleanup.functionArn,
      schedulerRoleArn: schedulerRole.roleArn,
      scheduleGroupName: scheduleGroup.scheduleGroupName,
    };
    runtimeConfig.set('mediaConvert', 'TranscodeCleanup', cleanupSettings);

    return { transcodeCleanup, scheduleGroup, schedulerRole, cleanupSettings };
  }
}
