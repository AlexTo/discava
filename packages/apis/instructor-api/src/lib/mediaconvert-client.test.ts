/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bestEffortCancelTranscodeJob,
  bestEffortCancelTranscodeJobs,
  submitTranscodeJob,
} from './mediaconvert-client.js';

const {
  mediaConvertSend,
  schedulerSend,
  resolveAppConfigValue,
  resolveLessonMediaBucketName,
  resolveLessonMediaUploadBucketName,
} = vi.hoisted(() => ({
  mediaConvertSend: vi.fn(),
  schedulerSend: vi.fn(),
  resolveAppConfigValue: vi.fn(),
  resolveLessonMediaBucketName: vi.fn(),
  resolveLessonMediaUploadBucketName: vi.fn(),
}));

vi.mock('@aws-sdk/client-mediaconvert', () => ({
  MediaConvertClient: vi.fn(function () {
    return { send: mediaConvertSend };
  }),
  CreateJobCommand: vi.fn(function (input) {
    return { __command: 'CreateJob', ...input };
  }),
  CancelJobCommand: vi.fn(function (input) {
    return { __command: 'CancelJob', ...input };
  }),
}));

vi.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: vi.fn(function () {
    return { send: schedulerSend };
  }),
  CreateScheduleCommand: vi.fn(function (input) {
    return { __command: 'CreateSchedule', ...input };
  }),
}));

vi.mock('./runtime-config.js', () => ({
  resolveAppConfigValue,
}));

vi.mock('./s3-client.js', () => ({
  resolveLessonMediaBucketName,
  resolveLessonMediaUploadBucketName,
}));

const COURSE_ID = 'course-1';
const MODULE_ID = 'module-1';
const LESSON_ID = 'lesson-1';
const CONTENT_ITEM_ID = 'content-item-1';
const OBJECT_KEY = `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${CONTENT_ITEM_ID}.mp4`;
const SUBMISSION_NONCE = 'nonce-1';
const UPLOAD_BUCKET_NAME = 'lesson-media-upload-bucket';
const MEDIA_BUCKET_NAME = 'lesson-media-bucket';
const ROLE_ARN = 'arn:aws:iam::123456789012:role/MediaConvert';
const JOB_TEMPLATE_ARN =
  'arn:aws:mediaconvert:ap-southeast-2:123456789012:jobTemplates/template';
const CLEANUP_LAMBDA_ARN =
  'arn:aws:lambda:ap-southeast-2:123456789012:function:TranscodeCleanup';
const SCHEDULER_ROLE_ARN =
  'arn:aws:iam::123456789012:role/TranscodeCleanupSchedulerRole';
const SCHEDULE_GROUP_NAME = 'discava-transcode-cleanup';

beforeEach(() => {
  vi.clearAllMocks();
  resolveAppConfigValue.mockImplementation(
    async (_namespace: string, key: string) => {
      if (key === 'VideoTranscodePipeline') {
        return { roleArn: ROLE_ARN, jobTemplateArn: JOB_TEMPLATE_ARN };
      }
      if (key === 'TranscodeCleanup') {
        return {
          lambdaArn: CLEANUP_LAMBDA_ARN,
          schedulerRoleArn: SCHEDULER_ROLE_ARN,
          scheduleGroupName: SCHEDULE_GROUP_NAME,
        };
      }
      throw new Error(`Unexpected resolveAppConfigValue key: ${key}`);
    },
  );
  resolveLessonMediaUploadBucketName.mockResolvedValue(UPLOAD_BUCKET_NAME);
  resolveLessonMediaBucketName.mockResolvedValue(MEDIA_BUCKET_NAME);
  mediaConvertSend.mockResolvedValue({ Job: { Id: 'job-1' } });
  schedulerSend.mockResolvedValue({});
});

describe('submitTranscodeJob', () => {
  it('submits a job referencing the resolved role, template, and bucket locations', async () => {
    const jobId = await submitTranscodeJob({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
      objectKey: OBJECT_KEY,
      submissionNonce: SUBMISSION_NONCE,
    });

    expect(jobId).toBe('job-1');
    expect(resolveAppConfigValue).toHaveBeenCalledWith(
      'mediaConvert',
      'VideoTranscodePipeline',
    );
    expect(mediaConvertSend).toHaveBeenCalledWith(
      expect.objectContaining({
        Role: ROLE_ARN,
        JobTemplate: JOB_TEMPLATE_ARN,
        UserMetadata: {
          courseId: COURSE_ID,
          moduleId: MODULE_ID,
          lessonId: LESSON_ID,
          contentItemId: CONTENT_ITEM_ID,
          rawObjectKey: OBJECT_KEY,
          submissionNonce: SUBMISSION_NONCE,
        },
      }),
    );
    const [command] = mediaConvertSend.mock.calls[0]!;
    expect(command.Settings.Inputs).toEqual([
      {
        FileInput: `s3://${UPLOAD_BUCKET_NAME}/${OBJECT_KEY}`,
        AudioSelectors: {
          'Audio Selector 1': { DefaultSelection: 'DEFAULT' },
        },
        TimecodeSource: 'ZEROBASED',
        VideoSelector: { Rotate: 'AUTO' },
      },
    ]);
    expect(
      command.Settings.OutputGroups[0].OutputGroupSettings.HlsGroupSettings
        .Destination,
    ).toBe(
      `s3://${MEDIA_BUCKET_NAME}/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${CONTENT_ITEM_ID}/${SUBMISSION_NONCE}/master`,
    );
  });

  // MediaConvert's own default is to ignore rotation metadata entirely,
  // even when present -- without this, a phone-shot portrait upload
  // transcodes sideways.
  it('applies automatic rotation from the input own container metadata', async () => {
    await submitTranscodeJob({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
      objectKey: OBJECT_KEY,
      submissionNonce: SUBMISSION_NONCE,
    });

    const [command] = mediaConvertSend.mock.calls[0]!;
    expect(command.Settings.Inputs[0].VideoSelector).toEqual({
      Rotate: 'AUTO',
    });
  });

  // Two submissions for the same content item -- e.g. a canceled job and
  // the replacement that superseded it -- must never write to the same S3
  // destination, or one job's output can end up mixed in with the
  // other's leftovers. Scoping by submissionNonce (not just
  // contentItemId) guarantees that: it's the one thing durably decided
  // before either job exists, and it's always different across two
  // genuinely different submissions.
  it('scopes the S3 destination by submissionNonce, not just contentItemId', async () => {
    await submitTranscodeJob({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
      objectKey: OBJECT_KEY,
      submissionNonce: SUBMISSION_NONCE,
    });
    const [firstCall] = mediaConvertSend.mock.calls[0]!;

    mediaConvertSend.mockClear();
    await submitTranscodeJob({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
      objectKey: OBJECT_KEY,
      submissionNonce: 'a-different-nonce',
    });
    const [secondCall] = mediaConvertSend.mock.calls[0]!;

    const firstDestination =
      firstCall.Settings.OutputGroups[0].OutputGroupSettings.HlsGroupSettings
        .Destination;
    const secondDestination =
      secondCall.Settings.OutputGroups[0].OutputGroupSettings.HlsGroupSettings
        .Destination;
    expect(firstDestination).toContain(SUBMISSION_NONCE);
    expect(secondDestination).toContain('a-different-nonce');
    expect(firstDestination).not.toBe(secondDestination);
  });

  // A retry of the same tRPC mutation (e.g. after a client-side timeout,
  // even though the original call actually succeeded) passes back the
  // exact same submissionNonce its record already has recorded -- CreateJob
  // must see the same ClientRequestToken both times so MediaConvert dedupes
  // it, rather than starting a redundant job.
  it('derives a stable ClientRequestToken from contentItemId and submissionNonce', async () => {
    await submitTranscodeJob({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
      objectKey: OBJECT_KEY,
      submissionNonce: SUBMISSION_NONCE,
    });
    const [firstCall] = mediaConvertSend.mock.calls[0]!;

    mediaConvertSend.mockClear();
    await submitTranscodeJob({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
      objectKey: OBJECT_KEY,
      submissionNonce: SUBMISSION_NONCE,
    });
    const [secondCall] = mediaConvertSend.mock.calls[0]!;

    expect(firstCall.ClientRequestToken).toBeTruthy();
    expect(firstCall.ClientRequestToken).toBe(secondCall.ClientRequestToken);
  });

  // A genuinely new submission always gets a fresh nonce from the caller
  // (see content-item-video.ts) -- this just confirms the token actually
  // changes when the nonce does, so two unrelated submissions can never
  // collide with each other no matter how identical their uploaded content
  // happens to be.
  it('derives a different ClientRequestToken for a different submissionNonce', async () => {
    await submitTranscodeJob({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
      objectKey: OBJECT_KEY,
      submissionNonce: SUBMISSION_NONCE,
    });
    const [firstCall] = mediaConvertSend.mock.calls[0]!;

    mediaConvertSend.mockClear();
    await submitTranscodeJob({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
      objectKey: OBJECT_KEY,
      submissionNonce: 'a-different-nonce',
    });
    const [secondCall] = mediaConvertSend.mock.calls[0]!;

    expect(firstCall.ClientRequestToken).not.toBe(
      secondCall.ClientRequestToken,
    );
  });

  it('propagates a failure to resolve the runtime config', async () => {
    resolveAppConfigValue.mockRejectedValue(
      new Error('RUNTIME_CONFIG_APP_ID environment variable is not set'),
    );

    await expect(
      submitTranscodeJob({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        contentItemId: CONTENT_ITEM_ID,
        objectKey: OBJECT_KEY,
        submissionNonce: SUBMISSION_NONCE,
      }),
    ).rejects.toThrow();
    expect(mediaConvertSend).not.toHaveBeenCalled();
  });

  it('propagates a MediaConvert CreateJob failure', async () => {
    mediaConvertSend.mockRejectedValue(
      new Error('MediaConvert is unavailable'),
    );

    await expect(
      submitTranscodeJob({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        contentItemId: CONTENT_ITEM_ID,
        objectKey: OBJECT_KEY,
        submissionNonce: SUBMISSION_NONCE,
      }),
    ).rejects.toThrow('MediaConvert is unavailable');
  });

  it('throws when the CreateJob response is missing Job.Id', async () => {
    mediaConvertSend.mockResolvedValue({ Job: {} });

    await expect(
      submitTranscodeJob({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        contentItemId: CONTENT_ITEM_ID,
        objectKey: OBJECT_KEY,
        submissionNonce: SUBMISSION_NONCE,
      }),
    ).rejects.toThrow('MediaConvert CreateJob response is missing Job.Id');
  });
});

const CANCELABLE_JOB = {
  jobId: 'job-1',
  courseId: COURSE_ID,
  moduleId: MODULE_ID,
  lessonId: LESSON_ID,
  contentItemId: CONTENT_ITEM_ID,
  submissionNonce: SUBMISSION_NONCE,
};

describe('bestEffortCancelTranscodeJob', () => {
  it('cancels the given job', async () => {
    mediaConvertSend.mockResolvedValue({});

    await bestEffortCancelTranscodeJob(undefined, CANCELABLE_JOB);

    expect(mediaConvertSend).toHaveBeenCalledWith(
      expect.objectContaining({ __command: 'CancelJob', Id: 'job-1' }),
    );
  });

  it('swallows a cancel failure and logs it', async () => {
    mediaConvertSend.mockRejectedValue(new Error('job already completed'));
    const logger = { error: vi.fn() };

    await expect(
      bestEffortCancelTranscodeJob(logger as any, CANCELABLE_JOB),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to cancel transcode job',
      expect.objectContaining({ jobId: 'job-1' }),
    );
  });

  it('tolerates a missing logger when cancellation fails', async () => {
    mediaConvertSend.mockRejectedValue(new Error('job already completed'));

    await expect(
      bestEffortCancelTranscodeJob(undefined, CANCELABLE_JOB),
    ).resolves.toBeUndefined();
  });

  // The prerequisite for safe cleanup: every canceled job's own nonce-
  // scoped prefix gets a schedule, regardless of what else is going on
  // with the content item afterward.
  it('schedules a delayed cleanup of the job’s own nonce-scoped prefix', async () => {
    await bestEffortCancelTranscodeJob(undefined, CANCELABLE_JOB);

    expect(schedulerSend).toHaveBeenCalledWith(
      expect.objectContaining({
        __command: 'CreateSchedule',
        GroupName: SCHEDULE_GROUP_NAME,
        FlexibleTimeWindow: { Mode: 'OFF' },
        ActionAfterCompletion: 'DELETE',
        Target: expect.objectContaining({
          Arn: CLEANUP_LAMBDA_ARN,
          RoleArn: SCHEDULER_ROLE_ARN,
          Input: JSON.stringify({
            courseId: COURSE_ID,
            moduleId: MODULE_ID,
            lessonId: LESSON_ID,
            contentItemId: CONTENT_ITEM_ID,
            submissionNonce: SUBMISSION_NONCE,
          }),
        }),
      }),
    );
  });

  // Whether or not the cancel itself succeeds, this job's output is
  // orphaned as far as the caller's record is concerned -- the caller
  // already decided to supersede or delete it regardless.
  it('still schedules cleanup even when the cancel itself fails', async () => {
    mediaConvertSend.mockRejectedValue(new Error('job already completed'));

    await bestEffortCancelTranscodeJob(undefined, CANCELABLE_JOB);

    expect(schedulerSend).toHaveBeenCalled();
  });

  it('skips scheduling cleanup for a job with no submissionNonce (a record from before it existed)', async () => {
    await bestEffortCancelTranscodeJob(undefined, {
      ...CANCELABLE_JOB,
      submissionNonce: undefined,
    });

    expect(schedulerSend).not.toHaveBeenCalled();
  });

  it('swallows a scheduling failure and logs it, without throwing', async () => {
    schedulerSend.mockRejectedValue(new Error('Scheduler is unavailable'));
    const logger = { error: vi.fn() };

    await expect(
      bestEffortCancelTranscodeJob(logger as any, CANCELABLE_JOB),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to schedule transcode cleanup',
      expect.objectContaining({ contentItemId: CONTENT_ITEM_ID }),
    );
  });
});

describe('bestEffortCancelTranscodeJobs', () => {
  const baseItem = {
    courseId: COURSE_ID,
    moduleId: MODULE_ID,
    lessonId: LESSON_ID,
    contentItemId: CONTENT_ITEM_ID,
    submissionNonce: SUBMISSION_NONCE,
  };

  it('cancels only pending items that have a job id', async () => {
    mediaConvertSend.mockResolvedValue({});

    await bestEffortCancelTranscodeJobs(undefined, [
      { ...baseItem, status: 'pending', mediaConvertJobId: 'job-1' },
      { ...baseItem, status: 'ready', mediaConvertJobId: 'job-2' },
      { ...baseItem, status: 'pending', mediaConvertJobId: undefined },
      { ...baseItem, status: 'failed', mediaConvertJobId: 'job-3' },
    ]);

    expect(mediaConvertSend).toHaveBeenCalledTimes(1);
    expect(mediaConvertSend).toHaveBeenCalledWith(
      expect.objectContaining({ __command: 'CancelJob', Id: 'job-1' }),
    );
  });

  it('does nothing when given no cancelable items', async () => {
    await bestEffortCancelTranscodeJobs(undefined, [
      { ...baseItem, status: 'ready', mediaConvertJobId: 'job-1' },
    ]);

    expect(mediaConvertSend).not.toHaveBeenCalled();
    expect(schedulerSend).not.toHaveBeenCalled();
  });
});

describe('in local dev (#137)', () => {
  const fetchMock = vi.fn();
  const body = (call: number) =>
    JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string);

  beforeEach(() => {
    vi.stubEnv('LOCAL_DEV', 'true');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('has the event runner transcode, writing where MediaConvert would', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ jobId: 'local-job-1' }), { status: 201 }),
    );

    await expect(
      submitTranscodeJob({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        contentItemId: CONTENT_ITEM_ID,
        objectKey: OBJECT_KEY,
        submissionNonce: 'nonce-1',
      }),
    ).resolves.toBe('local-job-1');

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:2024/transcode-jobs',
    );
    expect(body(0)).toEqual({
      inputKey: OBJECT_KEY,
      outputPrefix: `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${CONTENT_ITEM_ID}/nonce-1/`,
      userMetadata: {
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        contentItemId: CONTENT_ITEM_ID,
        rawObjectKey: OBJECT_KEY,
        submissionNonce: 'nonce-1',
      },
    });
    expect(mediaConvertSend).not.toHaveBeenCalled();
  });

  it('cancels through the event runner, and schedules the cleanup there', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await bestEffortCancelTranscodeJob(undefined, {
      jobId: 'local-job-1',
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
      submissionNonce: 'nonce-1',
    });

    expect(
      fetchMock.mock.calls.map(([url, init]) => [url, init.method]),
    ).toEqual([
      ['http://127.0.0.1:2024/transcode-jobs/local-job-1', 'DELETE'],
      ['http://127.0.0.1:2024/schedules/transcode-cleanup', 'POST'],
    ]);
    expect(body(1)).toEqual({
      payload: {
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        contentItemId: CONTENT_ITEM_ID,
        submissionNonce: 'nonce-1',
      },
    });
    expect(mediaConvertSend).not.toHaveBeenCalled();
    expect(schedulerSend).not.toHaveBeenCalled();
  });

  it('says to start the event runner when it isn’t running', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      submitTranscodeJob({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        contentItemId: CONTENT_ITEM_ID,
        objectKey: OBJECT_KEY,
        submissionNonce: 'nonce-1',
      }),
    ).rejects.toThrow('is @discava/events:dev running?');
  });
});
