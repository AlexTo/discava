/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getCloudFrontVideoUrl,
  getSignedCloudFrontCookies,
} from '@discava/common-server-utils/lesson-media';
import { isShown } from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import { VideoUrlInputSchema, VideoUrlOutputSchema } from '../schema/index.js';
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
      item.status !== 'ready' ||
      !item.s3Key
    ) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'This video is not available',
      });
    }

    // The directory holding this transcode's manifest, renditions and
    // segments: everything up to the slash before master.m3u8.
    const prefixKey = item.s3Key.slice(0, item.s3Key.lastIndexOf('/') + 1);
    const [url, cookies] = await Promise.all([
      getCloudFrontVideoUrl(item.s3Key),
      getSignedCloudFrontCookies(prefixKey),
    ]);
    ctx.responseCookies?.push(...cookies);
    return { url };
  });
