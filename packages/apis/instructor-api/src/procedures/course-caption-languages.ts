/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type CaptionTranslationSettings,
  MAX_CAPTION_LANGUAGES,
  resolveCaptionTranslationSettings,
} from '@discava/common-server-utils/caption-translation-settings';
import { CAPTION_LANGUAGES } from '@discava/common-web-utils/caption-languages';
import {
  InvalidRequestError,
  NotFoundError,
  setCourseCaptionLanguages,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { getCourseOrThrow } from '../helpers/course-access.js';
import { requireActiveCourse } from '../helpers/curriculum-guards.js';
import { courseInstructorProcedure } from '../init.js';
import {
  CourseCaptionLanguagesInputSchema,
  CourseCaptionLanguagesOutputSchema,
  type ICourseCaptionLanguagesOutput,
  UpdateCourseCaptionLanguagesInputSchema,
} from '../schema/index.js';

const reported = (
  languages: readonly string[] | undefined,
  settings: CaptionTranslationSettings,
): ICourseCaptionLanguagesOutput => ({
  languages: [...(languages ?? [])],
  supported: CAPTION_LANGUAGES.map(({ tag, label, nativeLabel }) => ({
    tag,
    label,
    nativeLabel,
  })),
  enabled: settings.enabled,
  maxLanguages: Math.min(MAX_CAPTION_LANGUAGES, settings.maxLanguagesPerCourse),
});

/** The languages a course's videos are translated into, and what the stage allows. */
export const courseCaptionLanguages = courseInstructorProcedure(
  CourseCaptionLanguagesInputSchema,
)
  .output(CourseCaptionLanguagesOutputSchema)
  .query(async ({ ctx, input }) => {
    const [course, settings] = await Promise.all([
      getCourseOrThrow(ctx.coreTable, input.courseId),
      resolveCaptionTranslationSettings(),
    ]);
    return reported(course.captionLanguages, settings);
  });

/**
 * Replaces a course's caption languages. Touches no video: the
 * caption-translation stream feature sees the course change and asks each
 * video for translation.
 */
export const updateCourseCaptionLanguages = courseInstructorProcedure(
  UpdateCourseCaptionLanguagesInputSchema,
)
  .output(CourseCaptionLanguagesOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const { courseId, languages } = input;
    await requireActiveCourse(ctx.coreTable, courseId);

    const settings = await resolveCaptionTranslationSettings();
    if (!settings.enabled && languages.length > 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Caption translation is not available',
      });
    }

    const result = reported(languages, settings);
    try {
      await setCourseCaptionLanguages(ctx.coreTable, {
        courseId,
        languages,
        maxLanguages: result.maxLanguages,
      });
    } catch (error) {
      if (error instanceof InvalidRequestError) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      }
      if (error instanceof NotFoundError) {
        throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
      }
      throw error;
    }
    return result;
  });
