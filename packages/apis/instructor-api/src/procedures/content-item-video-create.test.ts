/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  CONTENT_ITEM_ID,
  COURSE_ID,
  conditionalCheckFailedError,
  contentItem,
  contentItemCreate,
  contentItemDelete,
  contentItemPatch,
  contentItemPatchSet,
  contentItemQueryPrimary,
  courseGet,
  courseInstructorGet,
  INSTRUCTOR_SUB,
  installDefaults,
  LESSON_ID,
  lesson,
  lessonGet,
  MODULE_ID,
  moduleCheck,
  moduleGet,
  OBJECT_ETAG,
  OBJECT_KEY_PREFIX,
  transactionWrite,
} from './content-item-video.fixtures.js';
import {
  createContentItemVideo,
  updateContentItemVideo,
} from './content-item-video.js';

const {
  mockModule,
  getSignedUrl,
  s3Send,
  resolveLessonMediaUploadBucketName,
  bestEffortDeleteContentItemVideos,
  getSignedCloudFrontCookies,
  getCloudFrontVideoUrl,
  submitTranscodeJob,
  bestEffortCancelTranscodeJob,
  bestEffortCancelTranscodeJobs,
  getVideoUploadETag,
} = await vi.hoisted(
  async () => (await import('./content-item-video.fixtures.js')).spies,
);

vi.mock('@discava/core-table', async (importOriginal) =>
  mockModule(await importOriginal()),
);

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(),
  PutObjectCommand: vi.fn(function (input) {
    return input;
  }),
  DeleteObjectCommand: vi.fn(function (input) {
    return input;
  }),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl,
}));

// bestEffortDeleteContentItemVideos's own error-swallowing/bucket-selection
// behavior is covered directly in helpers/s3-client.test.ts; here it's just a
// mock so these tests can assert content-item-video.ts calls it correctly.
vi.mock('@discava/common-server-utils/lesson-media-bucket', () => ({
  getS3Client: () => ({ send: s3Send }),
  resolveLessonMediaUploadBucketName,
}));

vi.mock('../helpers/s3-client.js', () => ({
  bestEffortDeleteContentItemVideos,
  bestEffortRetirePreviousVersions: vi.fn(async () => {}),
  getVideoUploadETag,
}));

// getSignedCloudFrontCookies/getCloudFrontVideoUrl's own config-resolution/
// signing behavior is covered directly in @discava/common-server-utils's lesson-media.test.ts;
// here they're just mocks so these tests can assert createContentItemVideoUrl
// calls them correctly.
vi.mock('@discava/common-server-utils/lesson-media', () => ({
  getSignedCloudFrontCookies,
  getCloudFrontVideoUrl,
}));

// submitTranscodeJob's own MediaConvert-request-shape behavior is covered
// directly in helpers/mediaconvert-client.test.ts; here it's just a mock so
// these tests can assert create/updateContentItemVideo call it correctly.
vi.mock('../helpers/mediaconvert-client.js', () => ({
  submitTranscodeJob,
  bestEffortCancelTranscodeJob,
  bestEffortCancelTranscodeJobs,
}));

const router = t.router({
  createContentItemVideo,
  updateContentItemVideo,
});

const callAs = (groups: string[] = ['instructor']) =>
  callerFor(router, { sub: INSTRUCTOR_SUB, groups });

beforeEach(installDefaults);

describe('createContentItemVideo', () => {
  const validInput = {
    courseId: COURSE_ID,
    moduleId: MODULE_ID,
    lessonId: LESSON_ID,
    contentItemId: CONTENT_ITEM_ID,
    title: 'Intro video',
    objectKey: `${OBJECT_KEY_PREFIX}${CONTENT_ITEM_ID}.mp4`,
    mimeType: 'video/mp4',
  };

  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).createContentItemVideo(validInput),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the lesson does not exist', async () => {
    lessonGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().createContentItemVideo(validInput),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(contentItemCreate).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when the objectKey does not match the lesson and content item', async () => {
    await expect(
      callAs().createContentItemVideo({
        ...validInput,
        objectKey: `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/other-lesson/content-items/some-id.mp4`,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(contentItemCreate).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when the objectKey does not point to an uploaded file', async () => {
    getVideoUploadETag.mockResolvedValue(undefined);

    await expect(
      callAs().createContentItemVideo(validInput),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(contentItemCreate).not.toHaveBeenCalled();
  });

  // Invariant: same as every other new record -- visible straight away in a
  // draft course, hidden until published in a published one. (An archived
  // course is read-only: see below.)
  it.each([
    ['draft', 'visible'],
    ['published', 'hidden'],
  ] as const)(
    'in a %s course, creates the video record as %s',
    async (status, visibility) => {
      courseGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: { status } }),
      });

      await callAs().createContentItemVideo(validInput);

      expect(contentItemCreate).toHaveBeenCalledWith(
        expect.objectContaining({ visibility }),
      );
    },
  );

  // An archived course is read-only: nothing is created in it, and no
  // transcode is submitted.
  it('refuses to create a video in an archived course', async () => {
    courseGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: { status: 'archived' } }),
    });

    await expect(
      callAs().createContentItemVideo(validInput),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the course first',
    });
    expect(contentItemCreate).not.toHaveBeenCalled();
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the course does not exist', async () => {
    courseGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: null }),
    });

    await expect(
      callAs().createContentItemVideo(validInput),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(contentItemCreate).not.toHaveBeenCalled();
  });

  // The record is created in one transaction with checks on the module and
  // lesson, so a module archived after the procedure's own checks cancels
  // the create -- and no transcode is ever submitted for it.
  it('refuses, without submitting a transcode, when the module is archived in the meantime', async () => {
    moduleGet
      .mockReturnValueOnce({
        go: vi.fn().mockResolvedValue({
          data: { moduleId: MODULE_ID, visibility: 'visible' },
        }),
      })
      .mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: { moduleId: MODULE_ID, archivedAt: '2024-02-01T00:00:00.000Z' },
        }),
      });
    moduleCheck.mockReturnValue({
      where: () => ({
        go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
      }),
    });

    await expect(
      callAs().createContentItemVideo(validInput),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the module first',
    });
    expect(submitTranscodeJob).not.toHaveBeenCalled();
  });

  it('refuses to add a video under an archived module, before checking the upload', async () => {
    moduleGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { moduleId: MODULE_ID, archivedAt: '2024-02-01T00:00:00.000Z' },
      }),
    });

    await expect(
      callAs().createContentItemVideo(validInput),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the module first',
    });
    expect(getVideoUploadETag).not.toHaveBeenCalled();
    expect(contentItemCreate).not.toHaveBeenCalled();
  });

  it('refuses to add a video to an archived lesson, before checking the upload', async () => {
    lessonGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { ...lesson, archivedAt: '2024-02-01T00:00:00.000Z' },
      }),
    });

    await expect(
      callAs().createContentItemVideo(validInput),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(getVideoUploadETag).not.toHaveBeenCalled();
    expect(contentItemCreate).not.toHaveBeenCalled();
    expect(submitTranscodeJob).not.toHaveBeenCalled();
  });

  it('starts at order 1 and sets status pending for the first content item in a lesson', async () => {
    await callAs().createContentItemVideo(validInput);

    expect(contentItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'video',
        status: 'pending',
        order: 1,
        // Watched by the transcode reconciler until ready or failed (#125).
        transcodePending: 'pending',
        transcodePendingSince: expect.any(String),
      }),
    );
  });

  // Invariant: the transcode job must only be submitted once the record
  // exists, so its completion callback can never race the DynamoDB write
  // it needs to patch.
  it('submits the transcode job only after the content item record is created', async () => {
    const callOrder: string[] = [];
    contentItemCreate.mockReturnValue({
      go: vi.fn().mockImplementation(async () => {
        callOrder.push('create');
        return { data: contentItem };
      }),
    });
    submitTranscodeJob.mockImplementation(async () => {
      callOrder.push('submitTranscodeJob');
      return 'job-1';
    });
    contentItemPatchSet.mockReturnValue({
      where: () => ({
        go: vi.fn().mockImplementation(async () => {
          callOrder.push('patchJobId');
          return { data: contentItem };
        }),
      }),
    });

    await callAs().createContentItemVideo(validInput);

    expect(submitTranscodeJob).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
      objectKey: validInput.objectKey,
      submissionNonce: expect.any(String),
    });
    expect(callOrder).toEqual(['create', 'submitTranscodeJob', 'patchJobId']);
  });

  // The nonce is what submitTranscodeJob's ClientRequestToken is derived
  // from -- it has to be the exact same value the record itself is
  // stamped with, or a crashed retry could never reconnect to this job.
  it('stamps the record with the same nonce passed to submitTranscodeJob', async () => {
    await callAs().createContentItemVideo(validInput);

    const [createArgs] = contentItemCreate.mock.calls[0]!;
    const [submitArgs] = submitTranscodeJob.mock.calls[0]!;
    expect(createArgs.submissionNonce).toBeTruthy();
    expect(createArgs.submissionNonce).toBe(submitArgs.submissionNonce);
  });

  it('stamps the submitted job id onto the record so a later replacement can be told apart', async () => {
    await callAs().createContentItemVideo(validInput);

    expect(contentItemPatch).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
    });
    expect(contentItemPatchSet).toHaveBeenCalledWith({
      mediaConvertJobId: 'job-1',
      rawObjectETag: OBJECT_ETAG,
    });
  });

  // Invariant: a failed submission must never leave a permanently broken
  // 'pending' record with no job behind it -- the record didn't exist
  // before this call, so rolling back means deleting it, letting a retry
  // (even with the exact same input) start clean.
  it('deletes the newly created record when transcode submission fails', async () => {
    submitTranscodeJob.mockRejectedValue(
      new Error('MediaConvert is unavailable'),
    );

    await expect(callAs().createContentItemVideo(validInput)).rejects.toThrow(
      'MediaConvert is unavailable',
    );

    expect(contentItemDelete).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
    });
  });

  it('still surfaces the original submission error even if the rollback delete itself fails', async () => {
    submitTranscodeJob.mockRejectedValue(
      new Error('MediaConvert is unavailable'),
    );
    contentItemDelete.mockReturnValue({
      where: () => ({
        go: vi.fn().mockRejectedValue(new Error('DynamoDB is unavailable')),
      }),
    });

    await expect(callAs().createContentItemVideo(validInput)).rejects.toThrow(
      'MediaConvert is unavailable',
    );
  });

  it('does not stamp a job id when submission fails', async () => {
    submitTranscodeJob.mockRejectedValue(
      new Error('MediaConvert is unavailable'),
    );

    await expect(callAs().createContentItemVideo(validInput)).rejects.toThrow();

    expect(contentItemPatchSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ mediaConvertJobId: expect.anything() }),
    );
  });

  // Invariant: CreateJob succeeding means a real, billable job now exists
  // regardless of whether this stamp lands -- rolling back (deleting the
  // record) here would orphan it, since the completion event would then
  // find no record to patch. submissionNonce is already durable from the
  // .create() above, so a later retry's crash-gap check reconnects to
  // this exact job instead.
  it('does not delete the record when only the job-id stamp fails after a successful submission', async () => {
    contentItemPatchSet.mockReturnValueOnce({
      where: () => ({
        go: vi.fn().mockRejectedValue(new Error('DynamoDB is unavailable')),
      }),
    });

    const result = await callAs().createContentItemVideo(validInput);

    expect(result).toMatchObject({ contentItemId: CONTENT_ITEM_ID });
    expect(contentItemDelete).not.toHaveBeenCalled();
    expect(bestEffortCancelTranscodeJob).not.toHaveBeenCalled();
  });

  // Invariant: a concurrent updateContentItemVideo call could have already
  // read this just-created record and replaced it with its own submission
  // before this stamp lands -- losing the conditional write here means
  // this attempt's own job has nothing left pointing at it, since the
  // record has moved on to a different nonce/job entirely. Nothing else
  // will ever cancel or clean up that orphaned job, so this attempt has to.
  it('cancels its own job when the stamp loses ownership to a newer replacement', async () => {
    contentItemPatchSet.mockReturnValueOnce({
      where: () => ({
        go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
      }),
    });

    const result = await callAs().createContentItemVideo(validInput);

    expect(result).toMatchObject({ contentItemId: CONTENT_ITEM_ID });
    expect(contentItemDelete).not.toHaveBeenCalled();
    expect(bestEffortCancelTranscodeJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: 'job-1',
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        contentItemId: CONTENT_ITEM_ID,
      }),
    );
  });

  it('conditions the rollback delete on this attempt owning the record', async () => {
    submitTranscodeJob.mockRejectedValue(
      new Error('MediaConvert is unavailable'),
    );
    const deleteWhere = vi.fn().mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: contentItem }),
    });
    contentItemDelete.mockReturnValue({ where: deleteWhere });

    await expect(callAs().createContentItemVideo(validInput)).rejects.toThrow();

    const [whereCallback] = deleteWhere.mock.calls[0]!;
    const eq = vi.fn((attr: string, value: string) => `${attr} = ${value}`);
    const [submitArgs] = submitTranscodeJob.mock.calls[0]!;
    const result = whereCallback(
      { submissionNonce: 'submissionNonce' },
      { eq },
    );

    expect(eq).toHaveBeenCalledWith(
      'submissionNonce',
      submitArgs.submissionNonce,
    );
    expect(result).toBe(`submissionNonce = ${submitArgs.submissionNonce}`);
  });

  it('appends after the highest existing order', async () => {
    contentItemQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: [{ ...contentItem, order: 3 }],
      }),
    });

    await callAs().createContentItemVideo(validInput);

    expect(contentItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({ order: 4 }),
    );
  });
});
