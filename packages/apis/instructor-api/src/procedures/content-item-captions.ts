/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import {
  CAPTION_MAX_BYTES,
  captionKey,
  captionUploadKey,
  isWebVtt,
} from '@discava/common-server-utils/captions';
import {
  headLessonFileUpload,
  presignLessonFileUpload,
} from '@discava/common-server-utils/lesson-files';
import { manifestNonce } from '@discava/common-server-utils/media-keys';
import type { ICoreTableContext } from '@discava/common-server-utils/trpc-middleware';
import { captionLabel } from '@discava/common-web-utils/caption-languages';
import {
  applyCaptionChange,
  type CaptionChange,
  CaptionTrackError,
  captionWriteCondition,
  isConditionalCheckFailed,
  tracksForPlayback,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import {
  bestEffortDeleteCaptionFile,
  bestEffortDeleteCaptionUpload,
  putCaptionFile,
  readCaptionUpload,
} from '../lib/caption-files.js';
import {
  requireAncestorsNotArchived,
  requireCourseInstructor,
  requireNotArchived,
} from '../lib/course-lifecycle.js';
import {
  AttachCaptionInputSchema,
  CaptionTracksOutputSchema,
  CaptionUploadUrlInputSchema,
  CaptionUploadUrlOutputSchema,
  type ICaptionTracksOutput,
  RemoveCaptionInputSchema,
} from '../schema/index.js';

// Caption tracks an instructor manages (US5). A track's file is uploaded to
// the lesson media upload bucket through a presigned PUT, then checked and
// copied into the playing version's folder of the lesson media bucket when it
// is attached. Every change to the list goes through applyCaptionChange and a
// conditional write, so concurrent writers never both win.

type CoreTable = NonNullable<ICoreTableContext['coreTable']>;

interface ItemRef {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
}

// The caller's course's ready video, and the version (manifest nonce) it
// plays: captions belong to that version.
const requireReadyVideo = async (
  coreTable: CoreTable,
  ref: ItemRef,
  instructorId: string,
) => {
  await requireCourseInstructor(coreTable, ref.courseId, instructorId);
  const { data: item } = await coreTable.entities.contentItem.get(ref).go();
  if (!item || item.type !== 'video') {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  // An archived course, module, lesson or item is read-only, as for every
  // other content item write.
  await requireAncestorsNotArchived(coreTable, ref);
  requireNotArchived(item, 'Restore the content item before editing it');
  const nonce = item.s3Key ? manifestNonce(item.s3Key) : undefined;
  if (item.status !== 'ready' || !nonce) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'The video is not ready yet',
    });
  }
  return { item, nonce };
};

const tracksOutput = (
  tracks: Parameters<typeof tracksForPlayback>[0],
  nonce: string,
): ICaptionTracksOutput => ({
  captions: tracksForPlayback(tracks, nonce).map(
    ({ trackId, language, label, isDefault, source }) => ({
      trackId,
      language,
      label,
      isDefault,
      source,
    }),
  ),
});

const applyChange = (
  tracks: Parameters<typeof applyCaptionChange>[0],
  change: CaptionChange,
  nonce: string,
) => {
  try {
    return applyCaptionChange(tracks, change, { currentNonce: nonce });
  } catch (error) {
    if (error instanceof CaptionTrackError) {
      throw error.code === 'TOO_MANY_TRACKS'
        ? new TRPCError({ code: 'BAD_REQUEST', message: error.message })
        : new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'The video changed, try again',
          });
    }
    throw error;
  }
};

export const createContentItemCaptionUploadUrl = courseProcedure
  .input(CaptionUploadUrlInputSchema)
  .output(CaptionUploadUrlOutputSchema)
  .mutation(async ({ ctx, input }) => {
    await requireReadyVideo(ctx.coreTable!, input, ctx.user.sub);

    const uploadId = randomUUID();
    const { uploadUrl, headers } = await presignLessonFileUpload(
      captionUploadKey(input, uploadId),
      'text/vtt',
    );
    return { uploadId, url: uploadUrl, headers };
  });

export const attachContentItemCaption = courseProcedure
  .input(AttachCaptionInputSchema)
  .output(CaptionTracksOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { uploadId, language } = input;
    const ref: ItemRef = {
      courseId: input.courseId,
      moduleId: input.moduleId,
      lessonId: input.lessonId,
      contentItemId: input.contentItemId,
    };
    const { item, nonce } = await requireReadyVideo(
      coreTable,
      ref,
      ctx.user.sub,
    );

    // The key is built from ids the caller already has, never taken from them.
    const uploadKey = captionUploadKey(ref, uploadId);
    const upload = await headLessonFileUpload(uploadKey);
    if (!upload?.contentLength) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Upload the caption file before attaching it',
      });
    }
    if (upload.contentLength > CAPTION_MAX_BYTES) {
      await bestEffortDeleteCaptionUpload(ctx.logger, uploadKey);
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'The caption file is too large (1 MB at most)',
      });
    }
    const bytes = await readCaptionUpload(uploadKey);
    if (bytes.byteLength > CAPTION_MAX_BYTES || !isWebVtt(bytes)) {
      await bestEffortDeleteCaptionUpload(ctx.logger, uploadKey);
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'The file is not a WebVTT caption file',
      });
    }

    const rev = item.captionTracksRev ?? 0;
    const trackId = randomUUID();
    const key = captionKey(ref, nonce, trackId);
    // Checked before the copy, so a refused change leaves nothing behind.
    const change = applyChange(
      item.captionTracks,
      {
        type: 'add',
        nonce,
        track: {
          trackId,
          nonce,
          language,
          label: input.label ?? captionLabel(language),
          source: 'uploaded',
          key,
        },
      },
      nonce,
    );

    // Written from the bytes that were validated, not copied from the upload
    // key: its presigned PUT stays valid, so the object there can change
    // after it was read.
    await putCaptionFile(key, bytes);
    try {
      await coreTable.entities.contentItem
        .patch(ref)
        .set({
          captionTracks: change.tracks,
          captionTracksRev: rev + 1,
          // A track now exists, so captioning is no longer waiting or failed.
          ...(item.captionsStatus === 'failed' ||
          item.captionsStatus === 'pending'
            ? { captionsStatus: 'ready' as const }
            : {}),
        })
        .remove(['captionsPendingSince'])
        .where(captionWriteCondition(rev, nonce))
        .go();
    } catch (error) {
      await bestEffortDeleteCaptionFile(ctx.logger, key);
      if (isConditionalCheckFailed(error)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Try again' });
      }
      throw error;
    }

    if (change.replaced) {
      await bestEffortDeleteCaptionFile(ctx.logger, change.replaced.key);
    }
    await bestEffortDeleteCaptionUpload(ctx.logger, uploadKey);
    return tracksOutput(change.tracks, nonce);
  });

export const removeContentItemCaption = courseProcedure
  .input(RemoveCaptionInputSchema)
  .output(CaptionTracksOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { trackId, ...ref } = input;
    const { item, nonce } = await requireReadyVideo(
      coreTable,
      ref,
      ctx.user.sub,
    );

    const change = applyChange(
      item.captionTracks,
      { type: 'remove', nonce, trackId },
      nonce,
    );
    if (!change.removed) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }

    const rev = item.captionTracksRev ?? 0;
    try {
      await coreTable.entities.contentItem
        .patch(ref)
        .set({ captionTracks: change.tracks, captionTracksRev: rev + 1 })
        .where(captionWriteCondition(rev, nonce))
        .go();
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Try again' });
      }
      throw error;
    }

    await bestEffortDeleteCaptionFile(ctx.logger, change.removed.key);
    return tracksOutput(change.tracks, nonce);
  });
