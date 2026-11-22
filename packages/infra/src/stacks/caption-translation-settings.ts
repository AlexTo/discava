/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CaptionTranslationSettings } from '@discava/common-infra-config';

/**
 * The `captionTranslation.Settings` value for a stage: translation on, up to
 * nine languages a course, unless the stage's config says otherwise. Shared by
 * every stack that publishes it.
 */
export const captionTranslationSetting = (
  config: CaptionTranslationSettings | undefined,
) => ({
  enabled: config?.enabled ?? true,
  maxLanguagesPerCourse: config?.maxLanguagesPerCourse ?? 9,
});
