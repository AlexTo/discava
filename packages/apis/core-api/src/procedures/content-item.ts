/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getCloudFrontVideoUrl,
  getSignedCloudFrontCookies,
  getSignedCloudFrontFileUrl,
} from '@discava/common-server-utils/lesson-media';
import { isShown } from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import { playableManifest } from '../lib/playback.js';
import {
  FileUrlInputSchema,
  FileUrlOutputSchema,
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
    return { url, withCredentials: cookies.length > 0 };
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
