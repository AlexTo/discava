/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  getCloudFrontVideoUrl,
  getSignedCloudFrontCookies,
} from '@discava/common-server-utils/lesson-media';
import {
  getS3Client,
  resolveLessonMediaUploadBucketName,
} from '@discava/common-server-utils/lesson-media-bucket';
import { manifestNonce } from '@discava/common-server-utils/media-keys';
import {
  isConditionalCheckFailed,
  reportedCaptionsStatus,
  tracksForPlayback,
  transcodePendingFrom,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { v7 as uuidv7 } from 'uuid';
import { asContentItemOutput } from '../helpers/content-item.js';
import { getCourseOrThrow } from '../helpers/course-access.js';
import {
  initialVisibilityFields,
  requireAncestorsNotArchived,
  requireNotArchived,
  requireOrdinaryLesson,
} from '../helpers/curriculum-guards.js';
import {
  bestEffortCancelTranscodeJob,
  submitTranscodeJob,
} from '../helpers/mediaconvert-client.js';
import { writeAtEnd } from '../helpers/order.js';
import { getVideoUploadETag } from '../helpers/s3-client.js';
import {
  cancelAndResubmit,
  hasMetadata,
  isRetryOfInFlightSubmission,
  patchInFlightMetadata,
  patchMetadata,
  patchReplacement,
  pickSubmissionNonce,
  readVideoItem,
  requireObjectKeyInLesson,
} from '../helpers/video-replacement.js';
import { courseProcedure } from '../init.js';
import {
  CreateContentItemVideoInputSchema,
  CreateContentItemVideoOutputSchema,
  CreateContentItemVideoUploadUrlInputSchema,
  CreateContentItemVideoUploadUrlOutputSchema,
  CreateContentItemVideoUrlInputSchema,
  CreateContentItemVideoUrlOutputSchema,
  type ICreateContentItemVideoOutput,
  type IUpdateContentItemVideoOutput,
  UpdateContentItemVideoInputSchema,
  UpdateContentItemVideoOutputSchema,
} from '../schema/index.js';

// Extension -> content type allowlist for lesson videos. Anything else is
// rejected with BAD_REQUEST before a presigned URL is ever issued.
export const ALLOWED_VIDEO_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

export const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60;

export const createContentItemVideoUploadUrl = courseProcedure
  .input(CreateContentItemVideoUploadUrlInputSchema)
  .output(CreateContentItemVideoUploadUrlOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, moduleId, lessonId, fileName } = input;
    const { sub: currentUser } = ctx.user;

    // Only instructors teaching this specific course may attach video to
    // its lessons, not just any member of the instructor group.
    const { data: membership } = await coreTable.entities.courseInstructor
      .get({ courseId, instructorId: currentUser })
      .go();
    if (!membership) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }

    const { data: lesson } = await coreTable.entities.lesson
      .get({ courseId, moduleId, lessonId })
      .go();
    if (!lesson) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    // Refused before minting a URL, so nothing gets uploaded only for
    // createContentItemVideo/updateContentItemVideo to reject it.
    requireNotArchived(
      lesson,
      'Restore the lesson before adding content to it',
    );
    requireOrdinaryLesson(lesson);
    await requireAncestorsNotArchived(coreTable, { courseId, moduleId });

    const ext = extname(fileName).slice(1).toLowerCase();
    const contentType = ALLOWED_VIDEO_TYPES[ext];
    if (!contentType) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unsupported video file type. Allowed types: ${Object.keys(ALLOWED_VIDEO_TYPES).join(', ')}`,
      });
    }

    // A replacement reuses the existing item's id in the object key, so the
    // key's id segment always names a real content item.
    if (input.contentItemId !== undefined) {
      const { data: existing } = await coreTable.entities.contentItem
        .get({
          courseId,
          moduleId,
          lessonId,
          contentItemId: input.contentItemId,
        })
        .go();
      if (!existing || existing.type !== 'video') {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      requireNotArchived(
        existing,
        'Restore the content item before editing it',
      );
    }

    const contentItemId = input.contentItemId ?? uuidv7();
    // A fresh id per upload attempt, so two uploads (e.g. successive
    // replacements of one video) never share an S3 key and overwrite or
    // delete each other; DynamoDB conditions can't guard a plain S3 object.
    // submissionNonce scopes the transcode output the same way.
    const uploadId = randomUUID();
    const objectKey = `courses/${courseId}/modules/${moduleId}/lessons/${lessonId}/content-items/${contentItemId}/${uploadId}.${ext}`;

    const uploadUrl = await getSignedUrl(
      getS3Client(),
      new PutObjectCommand({
        Bucket: await resolveLessonMediaUploadBucketName(),
        Key: objectKey,
        ContentType: contentType,
      }),
      { expiresIn: UPLOAD_URL_EXPIRY_SECONDS },
    );

    return { contentItemId, uploadUrl, objectKey };
  });

export const createContentItemVideo = courseProcedure
  .input(CreateContentItemVideoInputSchema)
  .output(CreateContentItemVideoOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const {
      courseId,
      moduleId,
      lessonId,
      contentItemId,
      title,
      description,
      objectKey,
      mimeType,
      durationSeconds,
    } = input;
    const { sub: currentUser } = ctx.user;

    // Only instructors teaching this specific course may add content to
    // its lessons, not just any member of the instructor group.
    const { data: membership } = await coreTable.entities.courseInstructor
      .get({ courseId, instructorId: currentUser })
      .go();
    if (!membership) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }

    const { data: lesson } = await coreTable.entities.lesson
      .get({ courseId, moduleId, lessonId })
      .go();
    if (!lesson) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireNotArchived(
      lesson,
      'Restore the lesson before adding content to it',
    );
    requireOrdinaryLesson(lesson);
    await requireAncestorsNotArchived(coreTable, { courseId, moduleId });
    const course = await getCourseOrThrow(coreTable, courseId);

    // The object key must be one this lesson's own upload-url procedure
    // could have issued, so a caller can't record metadata pointing at an
    // object outside this lesson's prefix (e.g. another lesson's video).
    if (
      !objectKey.startsWith(
        `courses/${courseId}/modules/${moduleId}/lessons/${lessonId}/content-items/`,
      ) ||
      !objectKey.includes(contentItemId)
    ) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'objectKey does not match this lesson and content item',
      });
    }

    const objectETag = await getVideoUploadETag(objectKey);
    if (!objectETag) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'objectKey does not point to an uploaded file',
      });
    }

    // Feeds submitTranscodeJob's ClientRequestToken. Typed as plain string
    // because randomUUID()'s template-literal type doesn't fit op.eq() below.
    const submissionNonce: string = randomUUID();

    // Appended to the lesson in the same transaction as checks that the
    // module and lesson are still there and not archived, so one archived or
    // deleted after the checks above can't end up with new content.
    const key = { courseId, moduleId, lessonId, contentItemId };
    await writeAtEnd(coreTable, key, (entities, order) => [
      entities.contentItem
        .create({
          ...key,
          type: 'video',
          status: 'pending',
          title,
          description,
          s3Key: objectKey,
          mimeType,
          durationSeconds,
          order,
          ...initialVisibilityFields(course),
          submissionNonce,
          // Watched by the transcode reconciler until it's ready or failed.
          ...transcodePendingFrom(new Date()),
        })
        .commit(),
    ]);
    // Transactions don't return the written attributes.
    const { data: contentItem } = await coreTable.entities.contentItem
      .get(key)
      .go();

    let mediaConvertJobId: string;
    try {
      // Submitted only after the record exists, so the completion callback
      // (which patches this exact record once transcoding finishes) can
      // never race ahead of it.
      mediaConvertJobId = await submitTranscodeJob({
        courseId,
        moduleId,
        lessonId,
        contentItemId,
        objectKey,
        submissionNonce,
      });
    } catch (error) {
      // Submission failed: delete the record so a retry starts clean rather
      // than leaving a 'pending' item with no job. Conditioned on
      // submissionNonce, so a concurrent updateContentItemVideo that already
      // replaced this record isn't deleted out from under it.
      await coreTable.entities.contentItem
        .delete({ courseId, moduleId, lessonId, contentItemId })
        .where((attr, op) => op.eq(attr.submissionNonce, submissionNonce))
        .go()
        .catch((deleteError: unknown) => {
          ctx.logger?.error(
            'Failed to roll back content item after failed transcode submission',
            { error: deleteError, courseId, moduleId, lessonId, contentItemId },
          );
        });
      throw error;
    }

    try {
      // mediaConvertJobId lets transcode-complete.ts ignore a superseded
      // job's completion; rawObjectETag lets updateContentItemVideo tell a
      // retry of this submission from a real replacement. Conditioned on
      // submissionNonce so it can't repoint a concurrent replacement's record
      // at this attempt's job.
      await coreTable.entities.contentItem
        .patch({ courseId, moduleId, lessonId, contentItemId })
        .set({ mediaConvertJobId, rawObjectETag: objectETag })
        .where((attr, op) => op.eq(attr.submissionNonce, submissionNonce))
        .go();
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        // A concurrent replacement took the record over, so nothing points
        // at this attempt's job and nothing else will cancel or clean it up.
        await bestEffortCancelTranscodeJob(ctx.logger, {
          jobId: mediaConvertJobId,
          courseId,
          moduleId,
          lessonId,
          contentItemId,
          submissionNonce,
        });
      } else {
        // The job is running, so rolling back would orphan it. The stored
        // submissionNonce lets a retry reconnect to it via
        // ClientRequestToken, and transcode-complete.ts's nonce-conditioned
        // patch reconciles the record when it finishes.
        ctx.logger?.error(
          'Failed to stamp mediaConvertJobId after transcode submission',
          {
            error,
            courseId,
            moduleId,
            lessonId,
            contentItemId,
            mediaConvertJobId,
          },
        );
      }
    }

    return asContentItemOutput<ICreateContentItemVideoOutput>(contentItem);
  });

export const updateContentItemVideo = courseProcedure
  .input(UpdateContentItemVideoInputSchema)
  .output(UpdateContentItemVideoOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const {
      courseId,
      moduleId,
      lessonId,
      contentItemId,
      title,
      description,
      objectKey,
      mimeType,
      durationSeconds,
    } = input;
    const { sub: currentUser } = ctx.user;

    // Only instructors teaching this specific course may edit its lesson
    // content, not just any member of the instructor group.
    const { data: membership } = await coreTable.entities.courseInstructor
      .get({ courseId, instructorId: currentUser })
      .go();
    if (!membership) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }

    const { data: existing } = await coreTable.entities.contentItem
      .get({ courseId, moduleId, lessonId, contentItemId })
      .go();
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }

    // A content item's type is fixed at creation -- there's no supported
    // path to turn a text item into a video.
    if (existing.type !== 'video') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Content item is type '${existing.type}', not 'video'`,
      });
    }
    requireNotArchived(existing, 'Restore the content item before editing it');
    await requireAncestorsNotArchived(coreTable, {
      courseId,
      moduleId,
      lessonId,
    });

    const videoKey = { courseId, moduleId, lessonId, contentItemId };
    const write = { coreTable, videoKey, existing };
    const metadata = { title, description, mimeType, durationSeconds };

    if (objectKey === undefined) {
      await patchMetadata(write, metadata);
      return asContentItemOutput<IUpdateContentItemVideoOutput>(
        await readVideoItem(coreTable, videoKey),
      );
    }

    requireObjectKeyInLesson(videoKey, objectKey);
    const objectETag = await getVideoUploadETag(objectKey);
    if (!objectETag) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'objectKey does not point to an uploaded file',
      });
    }

    if (isRetryOfInFlightSubmission(existing, objectKey, objectETag)) {
      if (!hasMetadata(metadata)) {
        return asContentItemOutput<IUpdateContentItemVideoOutput>(existing);
      }
      return asContentItemOutput<IUpdateContentItemVideoOutput>(
        await patchInFlightMetadata(write, metadata),
      );
    }

    const submissionNonce = pickSubmissionNonce(existing, objectKey);
    await patchReplacement(write, metadata, objectKey, submissionNonce);
    const contentItem = await readVideoItem(coreTable, videoKey);
    await cancelAndResubmit(
      write,
      ctx.logger,
      objectKey,
      objectETag,
      submissionNonce,
    );
    return asContentItemOutput<IUpdateContentItemVideoOutput>(contentItem);
  });

export const createContentItemVideoUrl = courseProcedure
  .input(CreateContentItemVideoUrlInputSchema)
  .output(CreateContentItemVideoUrlOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, moduleId, lessonId, contentItemId } = input;
    const { sub: currentUser } = ctx.user;

    // Only instructors teaching this specific course may view its lesson
    // videos, not just any member of the instructor group.
    const { data: membership } = await coreTable.entities.courseInstructor
      .get({ courseId, instructorId: currentUser })
      .go();
    if (!membership) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }

    const { data: contentItem } = await coreTable.entities.contentItem
      .get({ courseId, moduleId, lessonId, contentItemId })
      .go();
    if (
      !contentItem ||
      contentItem.type !== 'video' ||
      !contentItem.s3Key ||
      contentItem.status !== 'ready'
    ) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }

    // The folder holding this version's manifest, rendition playlists and
    // segments, up to and including the trailing slash.
    const prefixKey = contentItem.s3Key.slice(
      0,
      contentItem.s3Key.lastIndexOf('/') + 1,
    );
    const [url, cookies] = await Promise.all([
      getCloudFrontVideoUrl(contentItem.s3Key),
      getSignedCloudFrontCookies(prefixKey),
    ]);
    ctx.responseCookies?.push(...cookies);

    // The folder name is the version's identity; its tracks live under it.
    const versionId = manifestNonce(contentItem.s3Key) ?? '';
    const captions = await Promise.all(
      tracksForPlayback(contentItem.captionTracks, versionId).map(
        async (track) => ({
          trackId: track.trackId,
          language: track.language,
          label: track.label,
          isDefault: track.isDefault,
          source: track.source,
          url: await getCloudFrontVideoUrl(track.key),
        }),
      ),
    );

    return {
      url,
      withCredentials: cookies.length > 0,
      versionId,
      captionsStatus: reportedCaptionsStatus(contentItem),
      captions,
    };
  });
