/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { MAX_CAPTION_LANGUAGES } from '@discava/common-server-utils/caption-translation-settings';
import { isCaptionLanguage } from '@discava/common-web-utils/caption-languages';
import { z } from 'zod';

export const CourseCaptionLanguagesInputSchema = z.object({
  courseId: z.string(),
});

export const UpdateCourseCaptionLanguagesInputSchema = z.object({
  courseId: z.string(),
  languages: z
    .array(z.string().refine(isCaptionLanguage, 'Choose a listed language'))
    .max(MAX_CAPTION_LANGUAGES)
    .refine((languages) => new Set(languages).size === languages.length, {
      message: 'Each caption language can be chosen once',
    }),
});

export const CourseCaptionLanguagesOutputSchema = z.object({
  // The course's caption languages in order; [] when none.
  languages: z.array(z.string()),
  supported: z.array(
    z.object({
      tag: z.string(),
      label: z.string(),
      nativeLabel: z.string(),
    }),
  ),
  // The stage's setting.
  enabled: z.boolean(),
  maxLanguages: z.number(),
});

export type ICourseCaptionLanguagesOutput = z.output<
  typeof CourseCaptionLanguagesOutputSchema
>;

export const RetryCourseCaptionTranslationsInputSchema = z.object({
  courseId: z.string(),
});

export const RetryCourseCaptionTranslationsOutputSchema = z.object({
  // The number of videos asked.
  requested: z.number(),
});
