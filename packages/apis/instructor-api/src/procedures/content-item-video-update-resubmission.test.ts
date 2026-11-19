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
  contentItemGet,
  contentItemPatch,
  contentItemPatchSet,
  contentItemPatchWhere,
  INSTRUCTOR_SUB,
  installDefaults,
  LESSON_ID,
  MODULE_ID,
  OBJECT_ETAG,
  OBJECT_KEY_PREFIX,
} from './content-item-video.fixtures.js';
import { updateContentItemVideo } from './content-item-video.js';

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

  describe('when the replacement looks like a retry of an in-flight submission', () => {
    const pendingObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    const inFlightItem = {
      ...contentItem,
      status: 'pending' as const,
      s3Key: pendingObjectKey,
      mediaConvertJobId: 'job-1',
      rawObjectETag: OBJECT_ETAG,
      submissionNonce: 'existing-nonce',
    };

    it('reports the current state back unchanged, touching nothing', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: inFlightItem }),
      });

      const result = await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
      });

      // mediaConvertJobId/rawObjectETag/submissionNonce are internal-only
      // and stripped by the tRPC output schema, same as any other response.
      const {
        mediaConvertJobId: _job,
        rawObjectETag: _etag,
        submissionNonce: _nonce,
        ...expected
      } = inFlightItem;
      expect(result).toEqual(expected);
      expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
      expect(contentItemPatch).not.toHaveBeenCalled();
      expect(submitTranscodeJob).not.toHaveBeenCalled();
      expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
    });

    // Matching the upload only proves the transcode itself doesn't need
    // touching -- it says nothing about title/description/etc also being
    // unchanged (e.g. a retry after a lost response, with an edit made in
    // between). Those must still land.
    it('still applies supplied title/description edits, without touching the transcode', async () => {
      const updatedItem = {
        ...inFlightItem,
        title: 'New title',
        description: 'New description',
      };
      // The read before the write, then the re-read after it (transactions
      // don't return the written record).
      contentItemGet
        .mockReturnValueOnce({
          go: vi.fn().mockResolvedValue({ data: inFlightItem }),
        })
        .mockReturnValueOnce({
          go: vi.fn().mockResolvedValue({ data: updatedItem }),
        });

      const result = await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
        title: 'New title',
        description: 'New description',
      });

      expect(contentItemPatch).toHaveBeenCalledWith({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        contentItemId: CONTENT_ITEM_ID,
      });
      expect(contentItemPatchSet).toHaveBeenCalledWith({
        title: 'New title',
        description: 'New description',
      });
      expect(result.title).toBe('New title');
      expect(result.description).toBe('New description');
      expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
      expect(submitTranscodeJob).not.toHaveBeenCalled();
      expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
    });

    it('conditions the metadata-only patch on this record still owning the submission', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: inFlightItem }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
        title: 'New title',
      });

      const [whereCallback] = contentItemPatchWhere.mock.calls[0]!;
      const eq = vi.fn((attr: string, value: string) => `${attr} = ${value}`);
      const notExists = vi.fn(
        (attr: string) => `attribute_not_exists(${attr})`,
      );
      const result = whereCallback(
        { submissionNonce: 'submissionNonce', archivedAt: 'archivedAt' },
        { eq, notExists },
      );

      expect(eq).toHaveBeenCalledWith(
        'submissionNonce',
        inFlightItem.submissionNonce,
      );
      expect(notExists).toHaveBeenCalledWith('archivedAt');
      expect(result).toBe(
        `submissionNonce = ${inFlightItem.submissionNonce} AND attribute_not_exists(archivedAt)`,
      );
    });

    it('throws CONFLICT, rather than reporting success, when the metadata edit loses ownership of the submission', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: inFlightItem }),
      });
      contentItemPatchWhere.mockReturnValue({
        go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
      });

      await expect(
        callAs().updateContentItemVideo({
          ...input,
          objectKey: pendingObjectKey,
          title: 'New title',
        }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'Content item was modified by another request; please retry',
      });
      expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
      expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
      expect(submitTranscodeJob).not.toHaveBeenCalled();
    });

    it('rethrows a transient failure applying the metadata edit instead of swallowing it', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: inFlightItem }),
      });
      contentItemPatchWhere.mockReturnValue({
        go: vi.fn().mockRejectedValue(new Error('DynamoDB is unavailable')),
      });

      await expect(
        callAs().updateContentItemVideo({
          ...input,
          objectKey: pendingObjectKey,
          title: 'New title',
        }),
      ).rejects.toThrow('DynamoDB is unavailable');
    });

    it('does not short-circuit when the ETag differs (a genuine new replacement)', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: { ...inFlightItem, rawObjectETag: '"a-different-etag"' },
        }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
      });

      expect(bestEffortCancelTranscodeJobs).toHaveBeenCalled();
      expect(submitTranscodeJob).toHaveBeenCalled();
    });

    it('does not short-circuit when the objectKey differs', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: inFlightItem }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: `${OBJECT_KEY_PREFIX}yet-another-id.mp4`,
      });

      expect(bestEffortCancelTranscodeJobs).toHaveBeenCalled();
      expect(submitTranscodeJob).toHaveBeenCalled();
    });

    it('does not short-circuit when no job has been stamped yet', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: { ...inFlightItem, mediaConvertJobId: undefined },
        }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
      });

      expect(bestEffortCancelTranscodeJobs).toHaveBeenCalled();
      expect(submitTranscodeJob).toHaveBeenCalled();
    });

    it('does not short-circuit an already-ready item even if s3Key happened to match', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: { ...inFlightItem, status: 'ready' as const },
        }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
      });

      expect(bestEffortCancelTranscodeJobs).toHaveBeenCalled();
      expect(submitTranscodeJob).toHaveBeenCalled();
    });
  });

  // The nonce feeds submitTranscodeJob's ClientRequestToken: reusing the
  // record's own nonce is what lets a crashed retry reconnect to the job
  // that attempt already created.
  describe('submissionNonce', () => {
    const pendingObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;

    it('reuses the existing nonce when resuming a submission that never got its job id stamped', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: {
            ...contentItem,
            status: 'pending' as const,
            s3Key: pendingObjectKey,
            mediaConvertJobId: undefined,
            submissionNonce: 'crashed-attempt-nonce',
          },
        }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
      });

      expect(contentItemPatchSet).toHaveBeenCalledWith(
        expect.objectContaining({ submissionNonce: 'crashed-attempt-nonce' }),
      );
      expect(submitTranscodeJob).toHaveBeenCalledWith(
        expect.objectContaining({
          submissionNonce: 'crashed-attempt-nonce',
        }),
      );
    });

    it('mints a fresh nonce for a genuinely new replacement (different objectKey)', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: {
            ...contentItem,
            status: 'pending' as const,
            s3Key: `${OBJECT_KEY_PREFIX}some-unrelated-id.mp4`,
            mediaConvertJobId: undefined,
            submissionNonce: 'unrelated-attempt-nonce',
          },
        }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
      });

      const [patchArgs] = contentItemPatchSet.mock.calls[0]!;
      const [submitArgs] = submitTranscodeJob.mock.calls[0]!;
      expect(patchArgs.submissionNonce).not.toBe('unrelated-attempt-nonce');
      expect(submitArgs.submissionNonce).toBe(patchArgs.submissionNonce);
    });

    // A prior submission that already recorded a job id fully completed
    // its write cycle -- reusing its nonce here would let MediaConvert
    // dedupe onto that (soon to be canceled) job instead of the new
    // content this call is actually replacing it with.
    it('mints a fresh nonce when the content changed even though the objectKey and job id already recorded', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: {
            ...contentItem,
            status: 'pending' as const,
            s3Key: pendingObjectKey,
            mediaConvertJobId: 'job-1',
            rawObjectETag: '"a-different-etag"',
            submissionNonce: 'previous-attempt-nonce',
          },
        }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
      });

      const [patchArgs] = contentItemPatchSet.mock.calls[0]!;
      expect(patchArgs.submissionNonce).not.toBe('previous-attempt-nonce');
      expect(bestEffortCancelTranscodeJobs).toHaveBeenCalled();
    });

    it('mints a fresh nonce for a brand new video with no prior attempt', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: { ...contentItem, status: 'ready' as const },
        }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
      });

      const [patchArgs] = contentItemPatchSet.mock.calls[0]!;
      expect(patchArgs.submissionNonce).toBeTruthy();
    });
  });
});
