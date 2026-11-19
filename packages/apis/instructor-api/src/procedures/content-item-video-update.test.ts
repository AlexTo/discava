/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bestEffortRetirePreviousVersions } from '../helpers/s3-client.js';
import { t } from '../init.js';
import {
  CONTENT_ITEM_ID,
  COURSE_ID,
  conditionalCheckFailedError,
  contentItem,
  contentItemGet,
  contentItemPatch,
  contentItemPatchRemove,
  contentItemPatchSet,
  contentItemPatchWhere,
  courseGet,
  courseInstructorGet,
  INSTRUCTOR_SUB,
  installDefaults,
  LESSON_ID,
  lesson,
  lessonCheck,
  lessonGet,
  MODULE_ID,
  OBJECT_ETAG,
  OBJECT_KEY_PREFIX,
  textContentItem,
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

describe('updateContentItemVideo', () => {
  const input = {
    courseId: COURSE_ID,
    moduleId: MODULE_ID,
    lessonId: LESSON_ID,
    contentItemId: CONTENT_ITEM_ID,
  };

  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).updateContentItemVideo(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the content item does not exist', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(callAs().updateContentItemVideo(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(contentItemPatch).not.toHaveBeenCalled();
  });

  it('refuses to edit a video in an archived course, without touching MediaConvert', async () => {
    courseGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: { status: 'archived' } }),
    });

    await expect(callAs().updateContentItemVideo(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the course first',
    });
    expect(contentItemPatch).not.toHaveBeenCalled();
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses a replacement, without touching MediaConvert, when the lesson is archived in the meantime', async () => {
    lessonGet
      .mockReturnValueOnce({ go: vi.fn().mockResolvedValue({ data: lesson }) })
      .mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: { ...lesson, archivedAt: '2024-02-01T00:00:00.000Z' },
        }),
      });
    lessonCheck.mockReturnValue({
      where: () => ({
        go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
      }),
    });

    await expect(
      callAs().updateContentItemVideo({
        ...input,
        objectKey: `${OBJECT_KEY_PREFIX}${CONTENT_ITEM_ID}/replacement.mp4`,
        mimeType: 'video/mp4',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the lesson first',
    });
    expect(submitTranscodeJob).not.toHaveBeenCalled();
    expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
  });

  it('refuses to edit a video in an archived lesson before any side effect', async () => {
    lessonGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { ...lesson, archivedAt: '2024-02-01T00:00:00.000Z' },
      }),
    });

    await expect(
      callAs().updateContentItemVideo({ ...input, title: 'New title' }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the lesson first',
    });
    expect(contentItemPatch).not.toHaveBeenCalled();
    expect(submitTranscodeJob).not.toHaveBeenCalled();
  });

  // Invariant: an archived item must be restored before it's edited --
  // including replacing its file, which must not touch S3 or MediaConvert.
  it('refuses to edit an archived video before any side effect', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { ...contentItem, archivedAt: '2024-02-01T00:00:00.000Z' },
      }),
    });

    await expect(
      callAs().updateContentItemVideo({
        ...input,
        title: 'New title',
        objectKey: `${OBJECT_KEY_PREFIX}${CONTENT_ITEM_ID}/replacement.mp4`,
        mimeType: 'video/mp4',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the content item before editing it',
    });
    expect(contentItemPatch).not.toHaveBeenCalled();
    expect(getVideoUploadETag).not.toHaveBeenCalled();
    expect(submitTranscodeJob).not.toHaveBeenCalled();
    expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
  });

  it('only patches fields provided in the input', async () => {
    await callAs().updateContentItemVideo({
      ...input,
      title: 'Updated title',
    });

    expect(contentItemPatch).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
    });
    expect(contentItemPatchSet).toHaveBeenCalledWith({
      title: 'Updated title',
    });
    expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
    // No new file was uploaded, so there's nothing to transcode.
    expect(submitTranscodeJob).not.toHaveBeenCalled();
    expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when a replacement objectKey does not match the lesson and content item', async () => {
    await expect(
      callAs().updateContentItemVideo({
        ...input,
        objectKey: `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/other-lesson/content-items/some-id.mp4`,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(contentItemPatch).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when a replacement objectKey does not point to an uploaded file', async () => {
    getVideoUploadETag.mockResolvedValue(undefined);

    await expect(
      callAs().updateContentItemVideo({
        ...input,
        objectKey: `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(contentItemPatch).not.toHaveBeenCalled();
  });

  // A retry of this exact mutation (e.g. after a client-side timeout, even
  // though the original call actually succeeded) must not cancel and
  // resubmit a job that's already correctly running.
  // Invariant: a replaced ready video isn't deleted here; it stays as the
  // previous version until transcode-complete retires it. The new objectKey
  // only has to be scoped to the lesson, not carry this item's id.
  it('keeps a ready video playing as the previous version while its replacement transcodes (#209)', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;

    await callAs().updateContentItemVideo({
      ...input,
      objectKey: newObjectKey,
      mimeType: 'video/webm',
    });

    expect(contentItemPatchSet).toHaveBeenCalledWith({
      s3Key: newObjectKey,
      status: 'pending',
      submissionNonce: expect.any(String),
      previousS3Key: contentItem.s3Key,
      // Watched by the transcode reconciler until ready or failed (#125).
      transcodePending: 'pending',
      transcodePendingSince: expect.any(String),
      mimeType: 'video/webm',
    });
    // Retired by transcode-complete once the replacement is ready.
    expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
  });

  it.each([
    ['pending', 'still transcoding'],
    ['failed', 'failed'],
  ] as const)(
    'replacing a replacement that is %s deletes its upload and keeps the previous version',
    async (status, _waiting) => {
      const previousS3Key = `${OBJECT_KEY_PREFIX}${CONTENT_ITEM_ID}/old-nonce/master.m3u8`;
      const replacing = {
        ...contentItem,
        status,
        s3Key: `${OBJECT_KEY_PREFIX}first-replacement.mp4`,
        submissionNonce: 'first-nonce',
        previousS3Key,
      };
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: replacing }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: `${OBJECT_KEY_PREFIX}second-replacement.mp4`,
      });

      // previousS3Key is neither set again nor removed: it stays.
      expect(contentItemPatchSet.mock.calls[0][0]).not.toHaveProperty(
        'previousS3Key',
      );
      expect(bestEffortDeleteContentItemVideos).toHaveBeenCalledWith(
        expect.anything(),
        [replacing],
      );
      // The previous version is still what students play.
      expect(bestEffortRetirePreviousVersions).not.toHaveBeenCalled();
    },
  );

  // Invariant: same as createContentItemVideo -- submitting the job only
  // after the DynamoDB patch has landed means a fast transcode can't race
  // ahead of the state it needs to find when it completes.
  it('submits the transcode job only after the DynamoDB patch when replacing the file', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    const callOrder: string[] = [];
    contentItemPatchSet
      .mockReturnValueOnce({
        remove: () => ({
          where: () => ({
            go: vi.fn().mockImplementation(async () => {
              callOrder.push('patch');
              return { data: contentItem };
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        where: () => ({
          go: vi.fn().mockImplementation(async () => {
            callOrder.push('patchJobId');
            return { data: contentItem };
          }),
        }),
      });
    submitTranscodeJob.mockImplementation(async () => {
      callOrder.push('submitTranscodeJob');
      return 'job-1';
    });

    await callAs().updateContentItemVideo({
      ...input,
      objectKey: newObjectKey,
    });

    expect(submitTranscodeJob).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
      objectKey: newObjectKey,
      submissionNonce: expect.any(String),
    });
    expect(callOrder).toEqual(['patch', 'submitTranscodeJob', 'patchJobId']);
  });

  it('stamps the submitted job id onto the record when replacing the file', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;

    await callAs().updateContentItemVideo({
      ...input,
      objectKey: newObjectKey,
    });

    expect(contentItemPatchSet).toHaveBeenCalledWith({
      mediaConvertJobId: 'job-1',
      rawObjectETag: OBJECT_ETAG,
    });
  });

  // Invariant: a failed submission during a replace has already canceled
  // whatever job the previous video had (if any), so there's no working
  // state left to restore to. Marking it failed -- the same terminal state
  // a genuine MediaConvert ERROR would produce -- gives the instructor an
  // accurate signal instead of an indefinite "processing" spinner.
  it('marks the content item failed when transcode submission fails during a replace', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    submitTranscodeJob.mockRejectedValue(
      new Error('MediaConvert is unavailable'),
    );

    await expect(
      callAs().updateContentItemVideo({ ...input, objectKey: newObjectKey }),
    ).rejects.toThrow('MediaConvert is unavailable');

    expect(contentItemPatchSet).toHaveBeenCalledWith({ status: 'failed' });
  });

  // Invariant: CreateJob succeeding means a real, billable job now exists
  // regardless of whether this stamp lands -- marking the record failed
  // here would orphan it. submissionNonce is already durable from the
  // first patch, so a later retry's crash-gap check reconnects to this
  // exact job instead, and transcode-complete.ts's own nonce-conditioned
  // patch reconciles status once the job actually finishes.
  it('does not mark the content item failed when only the job-id stamp fails after a successful replace submission', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    contentItemPatchSet
      .mockReturnValueOnce({
        remove: () => ({
          where: () => ({
            go: vi.fn().mockResolvedValue({ data: contentItem }),
          }),
        }),
      })
      .mockReturnValueOnce({
        where: () => ({
          go: vi.fn().mockRejectedValue(new Error('DynamoDB is unavailable')),
        }),
      });

    const result = await callAs().updateContentItemVideo({
      ...input,
      objectKey: newObjectKey,
    });

    expect(result).toMatchObject({ contentItemId: CONTENT_ITEM_ID });
    expect(contentItemPatchSet).not.toHaveBeenCalledWith({ status: 'failed' });
    expect(bestEffortCancelTranscodeJob).not.toHaveBeenCalled();
  });

  // Invariant: same reasoning as createContentItemVideo's analogous test --
  // a second concurrent replacement could have already moved the record
  // onto its own nonce/job before this stamp lands, orphaning this
  // attempt's own job with nothing left to cancel or clean it up otherwise.
  it('cancels its own job when the stamp loses ownership to a newer replacement', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    contentItemPatchSet
      .mockReturnValueOnce({
        remove: () => ({
          where: () => ({
            go: vi.fn().mockResolvedValue({ data: contentItem }),
          }),
        }),
      })
      .mockReturnValueOnce({
        where: () => ({
          go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
        }),
      });

    const result = await callAs().updateContentItemVideo({
      ...input,
      objectKey: newObjectKey,
    });

    expect(result).toMatchObject({ contentItemId: CONTENT_ITEM_ID });
    expect(contentItemPatchSet).not.toHaveBeenCalledWith({ status: 'failed' });
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

  it('conditions the mark-failed patch on this attempt owning the record', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    submitTranscodeJob.mockRejectedValue(
      new Error('MediaConvert is unavailable'),
    );
    const markFailedWhere = vi.fn().mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: contentItem }),
    });
    const markFailedRemove = vi.fn();
    contentItemPatchSet
      .mockReturnValueOnce({
        remove: () => ({
          where: () => ({
            go: vi.fn().mockResolvedValue({ data: contentItem }),
          }),
        }),
      })
      .mockReturnValueOnce({
        remove: (attributes: string[]) => {
          markFailedRemove(attributes);
          return { where: markFailedWhere };
        },
      });

    await expect(
      callAs().updateContentItemVideo({ ...input, objectKey: newObjectKey }),
    ).rejects.toThrow('MediaConvert is unavailable');

    const [whereCallback] = markFailedWhere.mock.calls[0]!;
    const eq = vi.fn((attr: string, value: string) => `${attr} = ${value}`);
    const [firstPatchArgs] = contentItemPatchSet.mock.calls[0]!;
    const result = whereCallback(
      { submissionNonce: 'submissionNonce' },
      { eq },
    );

    expect(eq).toHaveBeenCalledWith(
      'submissionNonce',
      firstPatchArgs.submissionNonce,
    );
    expect(result).toBe(`submissionNonce = ${firstPatchArgs.submissionNonce}`);
    // Failed, so no longer waiting for a transcode (#125).
    expect(markFailedRemove).toHaveBeenCalledWith([
      'transcodePending',
      'transcodePendingSince',
    ]);
  });

  it('still surfaces the original submission error even if marking it failed also fails', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    submitTranscodeJob.mockRejectedValue(
      new Error('MediaConvert is unavailable'),
    );
    contentItemPatchSet
      .mockReturnValueOnce({
        remove: () => ({
          where: () => ({
            go: vi.fn().mockResolvedValue({ data: contentItem }),
          }),
        }),
      })
      .mockReturnValueOnce({
        remove: () => ({
          where: () => ({
            go: vi.fn().mockRejectedValue(new Error('DynamoDB is unavailable')),
          }),
        }),
      });

    await expect(
      callAs().updateContentItemVideo({ ...input, objectKey: newObjectKey }),
    ).rejects.toThrow('MediaConvert is unavailable');
  });

  // bestEffortCancelTranscodeJobs itself decides which items are actually
  // cancelable (status/job-id filtering covered in mediaconvert-client.test.ts);
  // this only needs to confirm updateContentItemVideo hands it the
  // pre-patch record whenever a replacement happens.
  it('passes the pre-replacement record to bestEffortCancelTranscodeJobs when replacing the file', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;

    await callAs().updateContentItemVideo({
      ...input,
      objectKey: newObjectKey,
    });

    expect(bestEffortCancelTranscodeJobs).toHaveBeenCalledWith(
      expect.anything(),
      [contentItem],
    );
  });

  // Invariant: cancellation schedules cleanup for the previous job's
  // output regardless of whether the cancel itself succeeds -- so it must
  // only run once this request's own conditional patch has proven its
  // view of the record is still current. Calling it beforehand risks
  // scheduling deletion of content that turns out to still be the
  // record's own current, legitimate output (e.g. the previous job
  // finished for real in the window between this request's initial read
  // and now, which the patch's own condition would catch and reject as
  // CONFLICT -- but only if cancellation hasn't already run by then).
  it('cancels the previous job only after the replacement patch has landed', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    const callOrder: string[] = [];
    contentItemPatchSet.mockReturnValueOnce({
      remove: () => ({
        where: () => ({
          go: vi.fn().mockImplementation(async () => {
            callOrder.push('patch');
            return { data: contentItem };
          }),
        }),
      }),
    });
    bestEffortCancelTranscodeJobs.mockImplementation(async () => {
      callOrder.push('cancel');
    });

    await callAs().updateContentItemVideo({
      ...input,
      objectKey: newObjectKey,
    });

    expect(callOrder).toEqual(['patch', 'cancel']);
  });

  // Invariant: two updateContentItemVideo replace calls for the same
  // content item racing each other would otherwise both submit a job
  // writing to the same S3 destination (#123). Conditioning the patch on
  // status/s3Key still matching what was read means whichever call lands
  // second sees its own DynamoDB write fail, rather than silently
  // proceeding to race the first call's job.
  it('throws CONFLICT when another request has already changed status/s3Key (concurrent replace)', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    contentItemPatchWhere.mockReturnValue({
      go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
    });

    await expect(
      callAs().updateContentItemVideo({ ...input, objectKey: newObjectKey }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Content item was modified by another request; please retry',
    });
    expect(submitTranscodeJob).not.toHaveBeenCalled();
  });

  // Invariant: a rejected replacement must leave the previous job (and
  // whatever content it's currently pointing at) completely untouched --
  // no cancellation attempt, and critically no cleanup scheduled for it,
  // since a CONFLICT here specifically means the record's real current
  // state no longer matches what this request read, so that job's output
  // may well still be the content item's own current, legitimate content.
  it('does not cancel the previous job when the replacement patch is rejected as a conflict', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    contentItemPatchWhere.mockReturnValue({
      go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
    });

    await expect(
      callAs().updateContentItemVideo({ ...input, objectKey: newObjectKey }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
  });

  it('conditions the patch on the status and s3Key read at the start of the call', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;

    await callAs().updateContentItemVideo({
      ...input,
      objectKey: newObjectKey,
    });

    const [whereCallback] = contentItemPatchWhere.mock.calls[0]!;
    const eq = vi.fn((attr: string, value: string) => `${attr} = ${value}`);
    const notExists = vi.fn((attr: string) => `attribute_not_exists(${attr})`);
    const result = whereCallback(
      { status: 'status', s3Key: 's3Key', archivedAt: 'archivedAt' },
      { eq, notExists },
    );

    expect(eq).toHaveBeenCalledWith('status', contentItem.status);
    expect(eq).toHaveBeenCalledWith('s3Key', contentItem.s3Key);
    expect(result).toBe(
      `status = ${contentItem.status} AND s3Key = ${contentItem.s3Key} AND attribute_not_exists(archivedAt)`,
    );
  });

  // Invariant: status and s3Key can read the same on both sides of a race
  // between two replacements of a pending item, so the patch is also
  // conditioned on submissionNonce, which each new submission changes.
  it('also conditions the patch on submissionNonce when the existing record has one', async () => {
    const pendingObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    const pendingItem = {
      ...contentItem,
      status: 'pending' as const,
      s3Key: pendingObjectKey,
      mediaConvertJobId: 'job-1',
      rawObjectETag: 'a-different-etag',
      submissionNonce: 'nonce-1',
    };
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: pendingItem }),
    });

    await callAs().updateContentItemVideo({
      ...input,
      objectKey: pendingObjectKey,
    });

    const [whereCallback] = contentItemPatchWhere.mock.calls[0]!;
    const eq = vi.fn((attr: string, value: string) => `${attr} = ${value}`);
    const notExists = vi.fn((attr: string) => `attribute_not_exists(${attr})`);
    const result = whereCallback(
      {
        status: 'status',
        s3Key: 's3Key',
        submissionNonce: 'submissionNonce',
        archivedAt: 'archivedAt',
      },
      { eq, notExists },
    );

    expect(eq).toHaveBeenCalledWith('submissionNonce', 'nonce-1');
    expect(result).toBe(
      `status = ${pendingItem.status} AND s3Key = ${pendingItem.s3Key} AND submissionNonce = nonce-1 AND attribute_not_exists(archivedAt)`,
    );
  });

  // Invariant: leaving the previous video's mediaConvertJobId in place
  // would make it indistinguishable, on a later retry, from a stale id
  // that no longer means anything -- a crash between submitTranscodeJob
  // succeeding and the follow-up stamp would then be read as "already
  // fully submitted with a defined (but wrong) job id" instead of "no job
  // stamped for this attempt yet", failing the crash-gap nonce-reuse
  // check and submitting a duplicate job instead of reconnecting to the
  // one that attempt already created.
  it('clears the previous mediaConvertJobId when replacing the file', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;

    await callAs().updateContentItemVideo({
      ...input,
      objectKey: newObjectKey,
    });

    expect(contentItemPatchRemove).toHaveBeenCalledWith(['mediaConvertJobId']);
  });

  it('does not condition a metadata-only edit on status/s3Key (no CONFLICT risk from a concurrent replace)', async () => {
    await callAs().updateContentItemVideo({
      ...input,
      title: 'Updated title',
    });

    // Only on the item not having been archived since it was read.
    const [whereCallback] = contentItemPatchWhere.mock.calls[0]!;
    const eq = vi.fn((attr: string, value: string) => `${attr} = ${value}`);
    const notExists = vi.fn((attr: string) => `attribute_not_exists(${attr})`);
    const result = whereCallback(
      {
        status: 'status',
        s3Key: 's3Key',
        submissionNonce: 'submissionNonce',
        archivedAt: 'archivedAt',
      },
      { eq, notExists },
    );

    expect(eq).not.toHaveBeenCalled();
    expect(result).toBe('attribute_not_exists(archivedAt)');
  });

  it('does not attempt an S3 delete when the objectKey is unchanged', async () => {
    await callAs().updateContentItemVideo({
      ...input,
      objectKey: contentItem.s3Key,
    });

    expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when the existing content item is not a video', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: textContentItem }),
    });

    await expect(callAs().updateContentItemVideo(input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(contentItemPatch).not.toHaveBeenCalled();
  });
});
