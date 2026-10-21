/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import {
  courseImageKey,
  isCourseImageKey,
} from '@discava/common-server-utils/public-media';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import {
  refreshInstructorCourseUpdatedAt,
  requireActiveCourse,
  requireCourseInstructor,
} from '../lib/course-lifecycle.js';
import {
  attachPublicMediaObject,
  bestEffortDetachPublicMediaObject,
  headPublicMediaObject,
  presignJpegUpload,
} from '../lib/public-media-client.js';
import {
  COURSE_IMAGE_MAX_BYTES,
  CreateCourseImageUploadUrlInputSchema,
  CreateCourseImageUploadUrlOutputSchema,
  UpdateCourseImageInputSchema,
  UpdateCourseImageOutputSchema,
} from '../schema/index.js';

// A course's display image (#76): a 16:9 JPEG the instructor portal crops in
// the browser, uploaded straight to the public media bucket, then saved on
// the course. Uploads arrive tagged to expire, and saving one keeps it, so an
// upload that's never saved cleans itself up.

export const createCourseImageUploadUrl = courseProcedure
  .input(CreateCourseImageUploadUrlInputSchema)
  .output(CreateCourseImageUploadUrlOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, contentLength } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    await requireActiveCourse(coreTable, courseId);

    const imageKey = courseImageKey(courseId, randomUUID());
    return {
      imageKey,
      ...(await presignJpegUpload(imageKey, contentLength)),
    };
  });

export const updateCourseImage = courseProcedure
  .input(UpdateCourseImageInputSchema)
  .output(UpdateCourseImageOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, imageKey } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    await requireActiveCourse(coreTable, courseId);

    if (imageKey !== null) {
      // Only an image createImageUploadUrl issued for this course, and only
      // once it's actually there: the presigned PUT already held it to a JPEG
      // of the size asked for.
      const upload = isCourseImageKey(courseId, imageKey)
        ? await headPublicMediaObject(imageKey)
        : undefined;
      if (
        upload?.contentType !== 'image/jpeg' ||
        (upload.contentLength ?? 0) > COURSE_IMAGE_MAX_BYTES
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Upload the image before saving it',
        });
      }
      // Kept before it's saved, so a saved image is never one about to
      // expire.
      await attachPublicMediaObject(imageKey);
    }

    let course;
    try {
      const patch = coreTable.entities.course.patch({ courseId });
      ({ data: course } = await (imageKey === null
        ? patch.remove(['imageKey'])
        : patch.set({ imageKey })
      ).go({ response: 'all_old' }));
    } catch (error) {
      if (imageKey !== null) {
        await bestEffortDetachPublicMediaObject(ctx.logger, imageKey);
      }
      throw error;
    }

    // The image this replaced, read from the write itself so two saves at
    // once each retire the one they actually replaced.
    const previous = course.imageKey;
    if (previous && previous !== imageKey) {
      await bestEffortDetachPublicMediaObject(ctx.logger, previous);
    }

    const { data: updated } = await coreTable.entities.course
      .get({ courseId })
      .go();
    if (!updated) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    await refreshInstructorCourseUpdatedAt(
      coreTable,
      courseId,
      updated.updatedAt,
    );
    return updated;
  });
