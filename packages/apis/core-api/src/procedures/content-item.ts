/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getCloudFrontVideoUrl,
  getSignedCloudFrontCookies,
  getSignedCloudFrontFileUrl,
} from '@discava/common-server-utils/lesson-media';
import { manifestNonce } from '@discava/common-server-utils/media-keys';
import {
  isShown,
  resumeAt,
  tracksForPlayback,
  videoPositionToStore,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import { playableManifest } from '../lib/playback.js';
import {
  FileUrlInputSchema,
  FileUrlOutputSchema,
  SaveVideoPositionInputSchema,
  SaveVideoPositionOutputSchema,
  VideoUrlInputSchema,
  VideoUrlOutputSchema,
} from '../schema/index.js';
import { getEnrolment, requireEnrolment } from './enrolment.js';

// A lesson video's stream URL, for a student enrolled in its course (including
// after the course is archived, which only makes it read-only). The video
// must be visible to students: its module, lesson and itself shown, and
// transcoded. Signed CloudFront cookies scoped to the video's directory
// (manifest, renditions and segments) go out as Set-Cookie, as instructor-api
// does for instructors previewing it.
export const videoUrl = courseProcedure
  .input(VideoUrlInputSchema)
  .output(VideoUrlOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const userId = ctx.user.sub;
    const { courseId, moduleId, lessonId, contentItemId } = input;

    const [
      { data: course },
      { data: module },
      { data: lesson },
      { data: item },
      enrolment,
      { data: position },
    ] = await Promise.all([
      coreTable.entities.course.get({ courseId }).go(),
      coreTable.entities.module.get({ courseId, moduleId }).go(),
      coreTable.entities.lesson.get({ courseId, moduleId, lessonId }).go(),
      coreTable.entities.contentItem
        .get({ courseId, moduleId, lessonId, contentItemId })
        .go(),
      getEnrolment(coreTable, courseId, userId),
      coreTable.entities.videoPosition
        .get({ userId, courseId, lessonId, contentItemId })
        .go(),
    ]);
    if (!course) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireEnrolment(course, enrolment);
    if (
      !module ||
      !lesson ||
      !item ||
      !isShown(module) ||
      !isShown(lesson) ||
      !isShown(item) ||
      item.type !== 'video' ||
      !playableManifest(item)
    ) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'This video is not available',
      });
    }

    // Its own transcode once ready, else the version kept playable while it's
    // replaced (#209).
    const manifest = playableManifest(item)!;
    // The directory holding this transcode's manifest, renditions and
    // segments: everything up to the slash before master.m3u8.
    const prefixKey = manifest.slice(0, manifest.lastIndexOf('/') + 1);
    const [url, cookies] = await Promise.all([
      getCloudFrontVideoUrl(manifest),
      getSignedCloudFrontCookies(prefixKey),
    ]);
    ctx.responseCookies?.push(...cookies);
    // The folder name is the version's identity: a replaced video has a new
    // one, and a position saved for another version no longer applies.
    const versionId = manifestNonce(manifest) ?? '';
    // Only the played version's tracks: while a replacement transcodes, the
    // previous version plays with its own.
    const captions = await Promise.all(
      tracksForPlayback(item.captionTracks, versionId).map(async (track) => ({
        trackId: track.trackId,
        language: track.language,
        label: track.label,
        isDefault: track.isDefault,
        url: await getCloudFrontVideoUrl(track.key),
      })),
    );
    return {
      url,
      withCredentials: cookies.length > 0,
      versionId,
      resumeAt: resumeAt(position ?? undefined, versionId),
      captions,
    };
  });

// Remembers where the caller got to in a video, so videoUrl can resume there.
// Written every few seconds by the player. Only the position is stored: not a
// completion, not student activity, and not progress. A save for a version
// students no longer play (the video was replaced meanwhile) is ignored.
export const saveVideoPosition = courseProcedure
  .input(SaveVideoPositionInputSchema)
  .output(SaveVideoPositionOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const userId = ctx.user.sub;
    const {
      courseId,
      moduleId,
      lessonId,
      contentItemId,
      versionId,
      positionSeconds,
      durationSeconds,
    } = input;

    const [
      { data: course },
      { data: module },
      { data: lesson },
      { data: item },
      enrolment,
    ] = await Promise.all([
      coreTable.entities.course.get({ courseId }).go(),
      coreTable.entities.module.get({ courseId, moduleId }).go(),
      coreTable.entities.lesson.get({ courseId, moduleId, lessonId }).go(),
      coreTable.entities.contentItem
        .get({ courseId, moduleId, lessonId, contentItemId })
        .go(),
      getEnrolment(coreTable, courseId, userId),
    ]);
    if (!course) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireEnrolment(course, enrolment);
    const manifest = item && playableManifest(item);
    if (
      !module ||
      !lesson ||
      !item ||
      !isShown(module) ||
      !isShown(lesson) ||
      !isShown(item) ||
      item.type !== 'video' ||
      !manifest
    ) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'This video is not available',
      });
    }
    if (course.status !== 'published') {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'This course is archived',
      });
    }
    if (manifestNonce(manifest) !== versionId) {
      return { saved: false };
    }

    // Creates the record on the first save, then overwrites it: the last
    // write wins.
    const stored = videoPositionToStore(positionSeconds, durationSeconds);
    await coreTable.entities.videoPosition
      .put({
        userId,
        courseId,
        moduleId,
        lessonId,
        contentItemId,
        positionSeconds: stored,
        versionId,
        savedAt: new Date().toISOString(),
      })
      .go();
    return { saved: true, positionSeconds: stored };
  });

// A short-lived signed link to download a file item's file (#102), for a
// student enrolled in its course (including after the course is archived),
// with the item, its lesson and module shown. Requesting the link records
// nothing: the student marks the item done themselves.
export const fileUrl = courseProcedure
  .input(FileUrlInputSchema)
  .output(FileUrlOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const userId = ctx.user.sub;
    const { courseId, moduleId, lessonId, contentItemId } = input;

    const [
      { data: course },
      { data: module },
      { data: lesson },
      { data: item },
      enrolment,
    ] = await Promise.all([
      coreTable.entities.course.get({ courseId }).go(),
      coreTable.entities.module.get({ courseId, moduleId }).go(),
      coreTable.entities.lesson.get({ courseId, moduleId, lessonId }).go(),
      coreTable.entities.contentItem
        .get({ courseId, moduleId, lessonId, contentItemId })
        .go(),
      getEnrolment(coreTable, courseId, userId),
    ]);
    if (!course) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireEnrolment(course, enrolment);
    if (
      !module ||
      !lesson ||
      !item ||
      !isShown(module) ||
      !isShown(lesson) ||
      !isShown(item) ||
      item.type !== 'file' ||
      !item.s3Key
    ) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'This file is not available',
      });
    }
    return { url: await getSignedCloudFrontFileUrl(item.s3Key) };
  });
