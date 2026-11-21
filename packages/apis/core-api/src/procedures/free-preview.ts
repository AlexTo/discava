/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getCloudFrontVideoUrl,
  getSignedCloudFrontCookies,
  getSignedCloudFrontFileUrl,
} from '@discava/common-server-utils/lesson-media';
import {
  FREE_PREVIEW_COOKIE_LIFETIME_SECONDS,
  manifestNonce,
  playableManifest,
} from '@discava/common-server-utils/media-keys';
import { isShown, tracksForPlayback } from '@discava/core-table';
import {
  asPreviewItem,
  loadOpenFreePreview,
  previewNotAvailable,
} from '../helpers/free-preview.js';
import { publicCourseProcedure } from '../init.js';
import {
  FileUrlOutputSchema,
  FreePreviewLessonInputSchema,
  FreePreviewLessonOutputSchema,
  FreePreviewMediaInputSchema,
  FreePreviewVideoUrlOutputSchema,
  type IFreePreviewItem,
} from '../schema/index.js';

// The operations open to anyone, signed in or not, for a lesson an instructor
// marked as a free preview. Each calls loadOpenFreePreview first, never reads
// ctx.user and never writes: a visitor leaves no record.

// An open preview lesson: its shown items in order, as FreePreviewItemSchema
// allows. No S3 key, answer key, caption source or hidden item leaves here.
export const freePreviewLesson = publicCourseProcedure
  .input(FreePreviewLessonInputSchema)
  .output(FreePreviewLessonOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { course, lesson } = await loadOpenFreePreview(coreTable, input);

    const { data } = await coreTable.entities.contentItem.query
      .primary({
        courseId: input.courseId,
        moduleId: input.moduleId,
        lessonId: input.lessonId,
      })
      .go({ pages: 'all' });
    const items = data
      .filter(isShown)
      .sort((a, b) => a.order - b.order)
      .flatMap((record) => asPreviewItem(record) ?? []) as IFreePreviewItem[];

    return {
      course: { courseId: course.courseId, title: course.title },
      lesson: {
        lessonId: lesson.lessonId,
        moduleId: lesson.moduleId,
        title: lesson.title,
        description: lesson.description,
      },
      items,
    };
  });

// A preview lesson's video stream, as course.previewVideoUrl signs a course
// preview: cookies for the played version's folder only, for an hour.
export const freePreviewVideoUrl = publicCourseProcedure
  .input(FreePreviewMediaInputSchema)
  .output(FreePreviewVideoUrlOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, lessonId, contentItemId } = input;
    await loadOpenFreePreview(coreTable, input);

    const { data: item } = await coreTable.entities.contentItem
      .get({ courseId, moduleId, lessonId, contentItemId })
      .go();
    const manifest = item && playableManifest(item);
    if (!item || !isShown(item) || item.type !== 'video' || !manifest) {
      throw previewNotAvailable();
    }

    // The played version's folder: everything up to the slash before
    // master.m3u8.
    const prefixKey = manifest.slice(0, manifest.lastIndexOf('/') + 1);
    const [url, cookies] = await Promise.all([
      getCloudFrontVideoUrl(manifest),
      getSignedCloudFrontCookies(prefixKey, {
        lifetimeSeconds: FREE_PREVIEW_COOKIE_LIFETIME_SECONDS,
      }),
    ]);
    ctx.responseCookies?.push(...cookies);

    const versionId = manifestNonce(manifest) ?? '';
    const captions = await Promise.all(
      tracksForPlayback(item.captionTracks, versionId).map(async (track) => ({
        trackId: track.trackId,
        language: track.language,
        label: track.label,
        isDefault: track.isDefault,
        url: await getCloudFrontVideoUrl(track.key),
      })),
    );
    return { url, withCredentials: cookies.length > 0, versionId, captions };
  });

// A short-lived link to download a preview lesson's file item.
export const freePreviewFileUrl = publicCourseProcedure
  .input(FreePreviewMediaInputSchema)
  .output(FileUrlOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, lessonId, contentItemId } = input;
    await loadOpenFreePreview(coreTable, input);

    const { data: item } = await coreTable.entities.contentItem
      .get({ courseId, moduleId, lessonId, contentItemId })
      .go();
    if (!item || !isShown(item) || item.type !== 'file' || !item.s3Key) {
      throw previewNotAvailable();
    }
    return { url: await getSignedCloudFrontFileUrl(item.s3Key) };
  });
