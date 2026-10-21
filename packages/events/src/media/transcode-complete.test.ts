/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transcodeComplete } from './transcode-complete.js';

const {
  contentItemPatch,
  contentItemPatchSet,
  contentItemPatchRemove,
  contentItemPatchWhere,
  s3Send,
  resolveLessonMediaUploadBucketName,
  scheduleTranscodeCleanupOrThrow,
} = vi.hoisted(() => ({
  contentItemPatch: vi.fn(),
  contentItemPatchSet: vi.fn(),
  contentItemPatchRemove: vi.fn(),
  contentItemPatchWhere: vi.fn(),
  s3Send: vi.fn(),
  resolveLessonMediaUploadBucketName: vi.fn(),
  scheduleTranscodeCleanupOrThrow: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      contentItem: {
        patch: contentItemPatch,
      },
    },
  })),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return { send: s3Send };
  }),
  DeleteObjectCommand: vi.fn(function (input) {
    return input;
  }),
}));

vi.mock('../lib/runtime-config.js', () => ({
  resolveLessonMediaUploadBucketName,
}));

// scheduleTranscodeCleanupOrThrow's own idempotency/propagation behavior is
// covered directly in lib/transcode-cleanup-scheduler.test.ts; here it's
// just a mock so these tests can assert transcode-complete.ts calls it
// correctly.
vi.mock('../lib/transcode-cleanup-scheduler.js', () => ({
  scheduleTranscodeCleanupOrThrow,
}));

// Shaped like ElectroDB's own wrapping of a rejected conditional write --
// see content-item-video.test.ts (instructor-api) for the same helper;
// can't share it across the package boundary.
const conditionalCheckFailedError = (): Error =>
  Object.assign(new Error('The conditional request failed'), {
    cause: Object.assign(new Error('The conditional request failed'), {
      name: 'ConditionalCheckFailedException',
    }),
  });

const COURSE_ID = 'course-1';
const MODULE_ID = 'module-1';
const LESSON_ID = 'lesson-1';
const CONTENT_ITEM_ID = 'content-item-1';
const RAW_OBJECT_KEY = `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${CONTENT_ITEM_ID}.mp4`;
const UPLOAD_BUCKET_NAME = 'lesson-media-upload-bucket';
const JOB_ID = 'job-1';
const SUBMISSION_NONCE = 'nonce-1';

const buildEvent = (
  status: string,
  jobId: string = JOB_ID,
  submissionNonce: string = SUBMISSION_NONCE,
) => ({
  version: '0',
  id: 'event-1',
  source: 'aws.mediaconvert',
  account: 'test-account',
  time: '2024-01-01T00:00:00.000Z',
  region: 'ap-southeast-2',
  resources: [`arn:aws:mediaconvert:ap-southeast-2:test-account:jobs/${jobId}`],
  'detail-type': 'MediaConvert Job State Change',
  detail: {
    jobId,
    status,
    userMetadata: {
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
      rawObjectKey: RAW_OBJECT_KEY,
      submissionNonce,
    },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveLessonMediaUploadBucketName.mockResolvedValue(UPLOAD_BUCKET_NAME);
  contentItemPatch.mockReturnValue({ set: contentItemPatchSet });
  contentItemPatchSet.mockReturnValue({
    where: contentItemPatchWhere,
    remove: contentItemPatchRemove,
  });
  contentItemPatchRemove.mockReturnValue({ where: contentItemPatchWhere });
  contentItemPatchWhere.mockReturnValue({
    go: vi.fn().mockResolvedValue({}),
  });
  s3Send.mockResolvedValue({});
  scheduleTranscodeCleanupOrThrow.mockResolvedValue(undefined);
});

describe('transcodeComplete', () => {
  it('marks the content item ready and repoints s3Key on COMPLETE', async () => {
    await transcodeComplete(buildEvent('COMPLETE') as any);

    expect(contentItemPatch).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
    });
    expect(contentItemPatchSet).toHaveBeenCalledWith({
      status: 'ready',
      s3Key: `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${CONTENT_ITEM_ID}/${SUBMISSION_NONCE}/master.m3u8`,
    });
  });

  // Must match submitTranscodeJob's Destination exactly, or a genuinely
  // completed job's output would never be found at the s3Key this stamps.
  it('scopes the repointed s3Key by the job own submissionNonce', async () => {
    const buildEventWithNonce = (nonce: string) => ({
      ...buildEvent('COMPLETE'),
      detail: {
        ...buildEvent('COMPLETE').detail,
        userMetadata: {
          ...buildEvent('COMPLETE').detail.userMetadata,
          submissionNonce: nonce,
        },
      },
    });

    await transcodeComplete(buildEventWithNonce('a-different-nonce') as any);

    expect(contentItemPatchSet).toHaveBeenCalledWith({
      status: 'ready',
      s3Key: `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${CONTENT_ITEM_ID}/a-different-nonce/master.m3u8`,
    });
  });

  it('deletes the raw upload from the upload bucket on COMPLETE', async () => {
    await transcodeComplete(buildEvent('COMPLETE') as any);

    expect(s3Send).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: UPLOAD_BUCKET_NAME,
        Key: RAW_OBJECT_KEY,
      }),
    );
  });

  it('does not delete the raw upload when the content item no longer owns this submission', async () => {
    contentItemPatchWhere.mockReturnValue({
      go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
    });

    await transcodeComplete(buildEvent('COMPLETE') as any);

    expect(s3Send).not.toHaveBeenCalled();
  });

  // A transient DynamoDB failure doesn't mean the record isn't still this
  // exact submission's own -- rethrowing lets EventBridge retry the whole
  // invocation instead of silently dropping a real completion event.
  it('rethrows a transient patch failure on COMPLETE instead of swallowing it', async () => {
    contentItemPatchWhere.mockReturnValue({
      go: vi.fn().mockRejectedValue(new Error('DynamoDB is unavailable')),
    });

    await expect(
      transcodeComplete(buildEvent('COMPLETE') as any),
    ).rejects.toThrow('DynamoDB is unavailable');

    expect(scheduleTranscodeCleanupOrThrow).not.toHaveBeenCalled();
    expect(s3Send).not.toHaveBeenCalled();
  });

  it('includes a condition matching the record to the submission that just completed', async () => {
    await transcodeComplete(buildEvent('COMPLETE') as any);

    const [whereCallback] = contentItemPatchWhere.mock.calls[0]!;
    const eq = vi.fn((attr: string, value: string) => `${attr} = ${value}`);
    const result = whereCallback(
      { submissionNonce: 'submissionNonce' },
      { eq },
    );

    expect(eq).toHaveBeenCalledWith('submissionNonce', SUBMISSION_NONCE);
    expect(result).toBe(`submissionNonce = ${SUBMISSION_NONCE}`);
  });

  it('does not mark the content item ready when a later replacement has superseded this job', async () => {
    contentItemPatchWhere.mockReturnValue({
      go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
    });

    // A replacement stamps a fresh submissionNonce onto the record before
    // this (superseded) job's own completion event could ever arrive --
    // this is what the condition actually keys off now, not jobId.
    await transcodeComplete(
      buildEvent('COMPLETE', JOB_ID, 'superseded-nonce') as any,
    );

    expect(s3Send).not.toHaveBeenCalled();
  });

  // The record no longer owning this submission doesn't mean the job's
  // own S3 output isn't real -- a submission whose mediaConvertJobId was
  // never stamped (see item 20) can't have had its output scheduled for
  // cleanup any other way, so this event is the only remaining trigger.
  it('schedules cleanup of this job own nonce-scoped output when the record no longer owns it, on COMPLETE', async () => {
    contentItemPatchWhere.mockReturnValue({
      go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
    });

    await transcodeComplete(
      buildEvent('COMPLETE', JOB_ID, 'superseded-nonce') as any,
    );

    expect(scheduleTranscodeCleanupOrThrow).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
      submissionNonce: 'superseded-nonce',
    });
  });

  it('propagates a scheduling failure on COMPLETE instead of swallowing it', async () => {
    contentItemPatchWhere.mockReturnValue({
      go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
    });
    scheduleTranscodeCleanupOrThrow.mockRejectedValue(
      new Error('Scheduler is unavailable'),
    );

    await expect(
      transcodeComplete(buildEvent('COMPLETE') as any),
    ).rejects.toThrow('Scheduler is unavailable');
  });

  it('swallows a raw upload delete failure so it does not crash the handler', async () => {
    s3Send.mockRejectedValue(new Error('S3 is unavailable'));

    await expect(
      transcodeComplete(buildEvent('COMPLETE') as any),
    ).resolves.toBeUndefined();
  });

  it('marks the content item failed and leaves the raw upload in place on ERROR', async () => {
    await transcodeComplete(buildEvent('ERROR') as any);

    expect(contentItemPatchSet).toHaveBeenCalledWith({ status: 'failed' });
    expect(s3Send).not.toHaveBeenCalled();
  });

  it('includes a condition matching the record to the submission that just errored', async () => {
    await transcodeComplete(buildEvent('ERROR') as any);

    const [whereCallback] = contentItemPatchWhere.mock.calls[0]!;
    const eq = vi.fn((attr: string, value: string) => `${attr} = ${value}`);
    const result = whereCallback(
      { submissionNonce: 'submissionNonce' },
      { eq },
    );

    expect(eq).toHaveBeenCalledWith('submissionNonce', SUBMISSION_NONCE);
    expect(result).toBe(`submissionNonce = ${SUBMISSION_NONCE}`);
  });

  it('schedules cleanup of this job own nonce-scoped output when the record no longer owns it, on ERROR', async () => {
    contentItemPatchWhere.mockReturnValue({
      go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
    });

    await expect(
      transcodeComplete(buildEvent('ERROR') as any),
    ).resolves.toBeUndefined();

    expect(scheduleTranscodeCleanupOrThrow).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
      submissionNonce: SUBMISSION_NONCE,
    });
  });

  it('rethrows a transient patch failure on ERROR instead of swallowing it', async () => {
    contentItemPatchWhere.mockReturnValue({
      go: vi.fn().mockRejectedValue(new Error('DynamoDB is unavailable')),
    });

    await expect(transcodeComplete(buildEvent('ERROR') as any)).rejects.toThrow(
      'DynamoDB is unavailable',
    );

    expect(scheduleTranscodeCleanupOrThrow).not.toHaveBeenCalled();
  });

  it('propagates a scheduling failure on ERROR instead of swallowing it', async () => {
    contentItemPatchWhere.mockReturnValue({
      go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
    });
    scheduleTranscodeCleanupOrThrow.mockRejectedValue(
      new Error('Scheduler is unavailable'),
    );

    await expect(transcodeComplete(buildEvent('ERROR') as any)).rejects.toThrow(
      'Scheduler is unavailable',
    );
  });

  it('ignores statuses other than COMPLETE or ERROR', async () => {
    await transcodeComplete(buildEvent('PROGRESSING') as any);

    expect(contentItemPatch).not.toHaveBeenCalled();
    expect(s3Send).not.toHaveBeenCalled();
  });
});

// An instructor can archive a video while it's still transcoding. The
// handler never reads the record, so archive state isn't an input here; what
// matters is that its write leaves archivedAt and visibility alone and isn't
// conditioned on them -- so the outcome still lands on an archived video (it
// plays once restored) without bringing it back for students.
describe('transcodeComplete leaves archive state and visibility alone', () => {
  // Renders a `.where()` callback into a readable condition string.
  const renderCondition = (where: (attr: any, op: any) => string): string =>
    where(new Proxy({}, { get: (_target, name) => String(name) }), {
      eq: (name: string, value: unknown) => `${name} = ${value}`,
    });

  it.each([
    ['COMPLETE', 'ready'],
    ['ERROR', 'failed'],
  ] as const)(
    'on %s, records the outcome without touching archivedAt or visibility',
    async (status, outcome) => {
      await transcodeComplete(buildEvent(status) as any);

      const [written] = contentItemPatchSet.mock.calls[0];
      expect(written.status).toBe(outcome);
      expect(written).not.toHaveProperty('archivedAt');
      expect(written).not.toHaveProperty('visibility');
      // Conditioned only on still owning this submission -- never on the
      // item's archive state, which would drop the outcome for an archived
      // video and leave it pending forever once restored.
      expect(renderCondition(contentItemPatchWhere.mock.calls[0][0])).toBe(
        `submissionNonce = ${SUBMISSION_NONCE}`,
      );
      expect(scheduleTranscodeCleanupOrThrow).not.toHaveBeenCalled();
    },
  );
});

describe('a completed replacement (#209)', () => {
  const PREVIOUS = `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${CONTENT_ITEM_ID}/old-nonce/master.m3u8`;

  const replacing = (previousS3Key?: string) => {
    const go = vi.fn().mockResolvedValue({
      data: previousS3Key ? { previousS3Key } : {},
    });
    contentItemPatchWhere.mockReturnValue({ go });
    return go;
  };

  it('takes over from the previous version, and deletes it once its cookies have expired', async () => {
    const go = replacing(PREVIOUS);

    await transcodeComplete(buildEvent('COMPLETE') as any);

    expect(contentItemPatchRemove).toHaveBeenCalledWith(['previousS3Key']);
    expect(go).toHaveBeenCalledWith({ response: 'all_old' });
    expect(scheduleTranscodeCleanupOrThrow).toHaveBeenCalledWith(
      {
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        contentItemId: CONTENT_ITEM_ID,
        submissionNonce: 'old-nonce',
      },
      // Four hours of cookies, and a margin.
      255,
    );
  });

  it('has nothing to retire for a first upload', async () => {
    replacing();

    await transcodeComplete(buildEvent('COMPLETE') as any);

    expect(scheduleTranscodeCleanupOrThrow).not.toHaveBeenCalled();
  });

  it('leaves a previous version from before nonces, which shares the item’s folder', async () => {
    replacing(
      `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${CONTENT_ITEM_ID}/master.m3u8`,
    );

    await transcodeComplete(buildEvent('COMPLETE') as any);

    expect(scheduleTranscodeCleanupOrThrow).not.toHaveBeenCalled();
  });

  it('still finishes when the previous version can’t be scheduled for deletion', async () => {
    replacing(PREVIOUS);
    scheduleTranscodeCleanupOrThrow.mockRejectedValueOnce(
      new Error('Scheduler is unavailable'),
    );

    await expect(
      transcodeComplete(buildEvent('COMPLETE') as any),
    ).resolves.toBeUndefined();
    // The swap happened, so the raw upload is still cleaned up.
    expect(s3Send).toHaveBeenCalledWith(
      expect.objectContaining({ Key: RAW_OBJECT_KEY }),
    );
  });

  it('keeps the previous version playing when the replacement fails', async () => {
    await transcodeComplete(buildEvent('ERROR') as any);

    expect(contentItemPatchSet).toHaveBeenCalledWith({ status: 'failed' });
    expect(contentItemPatchRemove).not.toHaveBeenCalled();
    expect(scheduleTranscodeCleanupOrThrow).not.toHaveBeenCalled();
  });
});
