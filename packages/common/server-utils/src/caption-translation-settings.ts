/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { isLocalDev, LOCAL_CAPTION_TRANSLATION } from './local-dev.js';
import { readOptionalSetting } from './settings.js';

/** The most caption languages a course can choose, whatever the stage allows. */
export const MAX_CAPTION_LANGUAGES = 9;

export interface CaptionTranslationSettings {
  enabled: boolean;
  maxLanguagesPerCourse: number;
}

const OFF: CaptionTranslationSettings = {
  enabled: false,
  maxLanguagesPerCourse: 0,
};

/**
 * The stage's caption translation settings: local dev's own values, else
 * the `captionTranslation.Settings` deploy-time setting with the language
 * limit clamped to 0..9. A stage that never published them translates
 * nothing.
 */
export const resolveCaptionTranslationSettings =
  async (): Promise<CaptionTranslationSettings> => {
    if (isLocalDev()) {
      return { ...LOCAL_CAPTION_TRANSLATION };
    }
    try {
      const value = readOptionalSetting<Partial<CaptionTranslationSettings>>(
        'captionTranslation',
        'Settings',
      );
      if (value === undefined) {
        return { ...OFF };
      }
      const max = Number(value.maxLanguagesPerCourse);
      return {
        enabled: value.enabled === true,
        maxLanguagesPerCourse: Number.isFinite(max)
          ? Math.min(MAX_CAPTION_LANGUAGES, Math.max(0, Math.trunc(max)))
          : 0,
      };
    } catch {
      return { ...OFF };
    }
  };
