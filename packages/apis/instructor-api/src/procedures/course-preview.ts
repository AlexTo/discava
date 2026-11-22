/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { resolveCaptionTranslationSettings } from '@discava/common-server-utils/caption-translation-settings';
import { scheduleTranscodeCleanup } from '@discava/common-server-utils/cleanup-scheduler';
import {
  getCloudFrontVideoUrl,
  getSignedCloudFrontCookies,
} from '@discava/common-server-utils/lesson-media';
import {
  getS3Client,
  resolveLessonMediaUploadBucketName,
} from '@discava/common-server-utils/lesson-media-bucket';
import {
  previewManifestNonce,
  RETIRED_VERSION_DELAY_MINUTES,
} from '@discava/common-server-utils/media-keys';
import {
  isConditionalCheckFailed,
  PREVIEW_MAX_SECONDS,
  reportedCaptionsStatus,
  TRANSCODE_PENDING_ATTRIBUTES,
  tracksForPlayback,
  transcodePendingFrom,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { reportedCaptionTranslations } from '../helpers/caption-translations.js';
import {} from '../helpers/course-access.js';
import {
  asPreviewSummary,
  previewPlayableManifest,
} from '../helpers/course-preview.js';
import {
  bestEffortCancelTranscodeJob,
  submitTranscodeJob,
} from '../helpers/mediaconvert-client.js';
import {
  bestEffortDeletePreviewUploads,
  getVideoUploadETag,
} from '../helpers/s3-client.js';
import { courseInstructorProcedure } from '../init.js';
import {
  CoursePreviewOutputSchema,
  CreateCoursePreviewInputSchema,
  CreateCoursePreviewUploadUrlInputSchema,
  CreateCoursePreviewUploadUrlOutputSchema,
  CreateCoursePreviewVideoUrlInputSchema,
  CreateCoursePreviewVideoUrlOutputSchema,
  RemoveCoursePreviewInputSchema,
  RemoveCoursePreviewOutputSchema,
  ReplaceCoursePreviewInputSchema,
} from '../schema/index.js';
import {
  ALLOWED_VIDEO_TYPES,
  UPLOAD_URL_EXPIRY_SECONDS,
} from './content-item-video.js';

const TOO_LONG_MESSAGE = 'A preview can be at most 5 minutes long';
const CHANGED_MESSAGE = 'The preview changed; reload and try again';

const requireDuration = (durationSeconds: number) => {
  if (durationSeconds > PREVIEW_MAX_SECONDS) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: TOO_LONG_MESSAGE });
  }
};

// The raw key must be one createUploadUrl could have issued for this course,
// and the object must really be there (the presigned PUT is not proof).
const requireUploadedKey = async (courseId: string, rawKey: string) => {
  if (!rawKey.startsWith(`courses/${courseId}/preview/uploads/`)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'rawKey does not match this course',
    });
  }
  const etag = await getVideoUploadETag(rawKey);
  if (!etag) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'rawKey does not point to an uploaded file',
    });
  }
  return etag;
};

export const createUploadUrl = courseInstructorProcedure(
  CreateCoursePreviewUploadUrlInputSchema,
)
  .output(CreateCoursePreviewUploadUrlOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const { courseId, fileName } = input;

    const ext = extname(fileName).slice(1).toLowerCase();
    const contentType = ALLOWED_VIDEO_TYPES[ext];
    if (!contentType) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unsupported video file type. Allowed types: ${Object.keys(ALLOWED_VIDEO_TYPES).join(', ')}`,
      });
    }

    // A fresh id per upload, so successive replacements never share a key.
    const objectKey = `courses/${courseId}/preview/uploads/${randomUUID()}.${ext}`;
    const uploadUrl = await getSignedUrl(
      getS3Client(),
      new PutObjectCommand({
        Bucket: await resolveLessonMediaUploadBucketName(),
        Key: objectKey,
        ContentType: contentType,
      }),
      { expiresIn: UPLOAD_URL_EXPIRY_SECONDS },
    );
    return { uploadUrl, objectKey };
  });

// Submits the attempt's transcode job and stamps its id and the raw upload's
// ETag on the record. `onSubmitFailed` undoes the attempt (a failed first
// upload leaves no record; a failed replacement is marked failed).
const startTranscode = async (
  ctx: { coreTable?: any; logger?: any },
  attempt: {
    courseId: string;
    rawKey: string;
    etag: string;
    submissionNonce: string;
  },
  onSubmitFailed: () => Promise<unknown>,
) => {
  const coreTable = ctx.coreTable!;
  const { courseId, rawKey, etag, submissionNonce } = attempt;
  let mediaConvertJobId: string;
  try {
    // Only after the record exists, so the completion callback can't race it.
    mediaConvertJobId = await submitTranscodeJob({
      target: 'coursePreview',
      courseId,
      objectKey: rawKey,
      submissionNonce,
    });
  } catch (error) {
    await onSubmitFailed().catch((undoError: unknown) => {
      ctx.logger?.error('Failed to undo a preview after a failed submission', {
        error: undoError,
        courseId,
      });
    });
    throw error;
  }

  try {
    // Conditioned on the nonce: a concurrent replacement may have moved the
    // record onto its own attempt, which this stamp must not repoint.
    await coreTable.entities.coursePreview
      .patch({ courseId })
      .set({ mediaConvertJobId, rawObjectETag: etag })
      .where((a: any, op: any) => op.eq(a.submissionNonce, submissionNonce))
      .go();
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      // Lost ownership: this job has nothing pointing at it any more.
      await bestEffortCancelTranscodeJob(ctx.logger, {
        target: 'coursePreview',
        jobId: mediaConvertJobId,
        courseId,
        submissionNonce,
      });
    } else {
      // The job is real and running; the completion handler reconciles the
      // record by nonce whether or not this stamp lands.
      ctx.logger?.error('Failed to stamp mediaConvertJobId on a preview', {
        error,
        courseId,
        mediaConvertJobId,
      });
    }
  }
};

export const create = courseInstructorProcedure(CreateCoursePreviewInputSchema)
  .output(CoursePreviewOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, rawKey, durationSeconds } = input;

    requireDuration(durationSeconds);
    const etag = await requireUploadedKey(courseId, rawKey);

    const submissionNonce: string = randomUUID();
    try {
      await coreTable.entities.coursePreview
        .create({
          courseId,
          status: 'processing',
          submissionNonce,
          durationSeconds: Math.round(durationSeconds),
          uploadedBy: ctx.user.sub,
          mimeType: ALLOWED_VIDEO_TYPES[extname(rawKey).slice(1).toLowerCase()],
          // Watched by the transcode reconciler until ready or failed.
          ...transcodePendingFrom(new Date()),
        })
        .go();
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This course already has a preview',
        });
      }
      throw error;
    }

    await startTranscode(
      ctx,
      { courseId, rawKey, etag, submissionNonce },
      // A first upload that never started leaves no record, so a retry starts
      // clean. Conditioned on the nonce, as a replacement may have won since.
      () =>
        coreTable.entities.coursePreview
          .delete({ courseId })
          .where((a, op) => op.eq(a.submissionNonce, submissionNonce))
          .go(),
    );

    const { data } = await coreTable.entities.coursePreview
      .get({ courseId })
      .go();
    if (!data) {
      throw new TRPCError({ code: 'CONFLICT', message: CHANGED_MESSAGE });
    }
    return asPreviewSummary(data);
  });

export const replace = courseInstructorProcedure(
  ReplaceCoursePreviewInputSchema,
)
  .output(CoursePreviewOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, rawKey, durationSeconds, expectedSubmissionNonce } =
      input;

    requireDuration(durationSeconds);

    const { data: existing } = await coreTable.entities.coursePreview
      .get({ courseId })
      .go();
    if (!existing) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'This course has no preview to replace',
      });
    }
    if (existing.submissionNonce !== expectedSubmissionNonce) {
      throw new TRPCError({ code: 'CONFLICT', message: CHANGED_MESSAGE });
    }
    const etag = await requireUploadedKey(courseId, rawKey);

    // A retry of the call that is already in flight (same file, job known):
    // leave the transcode alone.
    if (
      existing.status === 'processing' &&
      existing.mediaConvertJobId !== undefined &&
      existing.rawObjectETag === etag
    ) {
      return asPreviewSummary(existing);
    }
    // A crash between submitting the job and stamping its id: reuse the
    // nonce, so the job's idempotency token reconnects to the same job.
    const resumesCrashedAttempt =
      existing.status === 'processing' &&
      existing.mediaConvertJobId === undefined &&
      existing.rawObjectETag === etag;
    const submissionNonce: string = resumesCrashedAttempt
      ? existing.submissionNonce
      : randomUUID();

    try {
      await coreTable.entities.coursePreview
        .patch({ courseId })
        .set({
          status: 'processing',
          submissionNonce,
          durationSeconds: Math.round(durationSeconds),
          uploadedBy: ctx.user.sub,
          mimeType: ALLOWED_VIDEO_TYPES[extname(rawKey).slice(1).toLowerCase()],
          // The ready version keeps playing as the previous one; replacing a
          // replacement in flight, or a failed one, keeps the one it had.
          ...(existing.status === 'ready' &&
            existing.s3Key && { previousS3Key: existing.s3Key }),
          ...transcodePendingFrom(new Date()),
        })
        .remove([
          's3Key',
          'mediaConvertJobId',
          'rawObjectETag',
          'failureReason',
        ])
        .where((a, op) => op.eq(a.submissionNonce, expectedSubmissionNonce))
        .go();
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new TRPCError({ code: 'CONFLICT', message: CHANGED_MESSAGE });
      }
      throw error;
    }

    // The attempt this one superseded: its job and output are orphaned.
    if (existing.status === 'processing') {
      if (existing.mediaConvertJobId && !resumesCrashedAttempt) {
        await bestEffortCancelTranscodeJob(ctx.logger, {
          target: 'coursePreview',
          jobId: existing.mediaConvertJobId,
          courseId,
          submissionNonce: existing.submissionNonce,
        });
      }
    }

    await startTranscode(
      ctx,
      { courseId, rawKey, etag, submissionNonce },
      // Nothing is left to restore: mark the attempt failed, so the editor
      // shows it instead of an endless "processing". The previous version,
      // if any, keeps playing.
      () =>
        coreTable.entities.coursePreview
          .patch({ courseId })
          .set({ status: 'failed', failureReason: 'transcode-error' })
          .remove([...TRANSCODE_PENDING_ATTRIBUTES])
          .where((a, op) => op.eq(a.submissionNonce, submissionNonce))
          .go(),
    );

    const { data } = await coreTable.entities.coursePreview
      .get({ courseId })
      .go();
    if (!data) {
      throw new TRPCError({ code: 'CONFLICT', message: CHANGED_MESSAGE });
    }
    return asPreviewSummary(data);
  });

export const remove = courseInstructorProcedure(RemoveCoursePreviewInputSchema)
  .output(RemoveCoursePreviewOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, expectedSubmissionNonce } = input;

    let old:
      | {
          status: string;
          s3Key?: string;
          previousS3Key?: string;
          submissionNonce: string;
          mediaConvertJobId?: string;
        }
      | null
      | undefined;
    try {
      ({ data: old } = await coreTable.entities.coursePreview
        .delete({ courseId })
        .where((a, op) => op.eq(a.submissionNonce, expectedSubmissionNonce))
        .go({ response: 'all_old' }));
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new TRPCError({ code: 'CONFLICT', message: CHANGED_MESSAGE });
      }
      throw error;
    }

    if (old) {
      // Every version folder: viewers may hold cookies for a played one, so
      // those wait out the signed cookies; an attempt in flight is cancelled
      // and its folder follows after the usual short delay.
      const played = new Set(
        [old.s3Key, old.previousS3Key].flatMap((key) => {
          const nonce = key && previewManifestNonce(key);
          return nonce ? [nonce] : [];
        }),
      );
      await Promise.all(
        [...played].map((submissionNonce) =>
          scheduleTranscodeCleanup(
            ctx.logger,
            { target: 'coursePreview', courseId, submissionNonce },
            RETIRED_VERSION_DELAY_MINUTES,
          ),
        ),
      );
      if (!played.has(old.submissionNonce)) {
        if (old.status === 'processing' && old.mediaConvertJobId) {
          await bestEffortCancelTranscodeJob(ctx.logger, {
            target: 'coursePreview',
            jobId: old.mediaConvertJobId,
            courseId,
            submissionNonce: old.submissionNonce,
          });
        } else {
          await scheduleTranscodeCleanup(ctx.logger, {
            target: 'coursePreview',
            courseId,
            submissionNonce: old.submissionNonce,
          });
        }
      }
    }
    await bestEffortDeletePreviewUploads(ctx.logger, courseId);

    return { removed: true as const };
  });

export const createVideoUrl = courseInstructorProcedure(
  CreateCoursePreviewVideoUrlInputSchema,
)
  .output(CreateCoursePreviewVideoUrlOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId } = input;

    const { data: preview } = await coreTable.entities.coursePreview
      .get({ courseId })
      .go();
    const manifest = preview && previewPlayableManifest(preview);
    if (!preview || !manifest) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }

    const prefixKey = manifest.slice(0, manifest.lastIndexOf('/') + 1);
    const [url, cookies] = await Promise.all([
      getCloudFrontVideoUrl(manifest),
      getSignedCloudFrontCookies(prefixKey),
    ]);
    ctx.responseCookies?.push(...cookies);

    const versionId = previewManifestNonce(manifest) ?? '';
    const captions = await Promise.all(
      tracksForPlayback(preview.captionTracks, versionId).map(
        async (track) => ({
          trackId: track.trackId,
          language: track.language,
          label: track.label,
          isDefault: track.isDefault,
          source: track.source,
          machineTranslated: track.source === 'translated',
          url: await getCloudFrontVideoUrl(track.key),
        }),
      ),
    );
    const [{ data: course }, settings] = await Promise.all([
      coreTable.entities.course.get({ courseId }).go(),
      resolveCaptionTranslationSettings(),
    ]);
    return {
      url,
      withCredentials: cookies.length > 0,
      versionId,
      captionsStatus: reportedCaptionsStatus(preview),
      captions,
      translations: reportedCaptionTranslations(
        { ...preview, nonce: versionId },
        course ?? {},
        settings,
      ),
    };
  });
