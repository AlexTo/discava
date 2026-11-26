/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { isLocalDev, LOCAL_CAPTION_TRANSLATION } from './local-dev.js';
import { readSetting, settingEnvName } from './settings.js';

/** The most caption languages a course can choose, whatever the stage allows. */
export const MAX_CAPTION_LANGUAGES = 9;

export interface CaptionTranslationSettings {
  enabled: boolean;
  maxLanguagesPerCourse: number;
}

const parseFlag = (name: string, raw: string): boolean => {
  if (raw !== 'true' && raw !== 'false') {
    throw new Error(`Invalid deploy-time setting ${name}`);
  }
  return raw === 'true';
};

const parseCount = (name: string, raw: string): number => {
  const count = Number(raw);
  if (!Number.isFinite(count)) {
    throw new Error(`Invalid deploy-time setting ${name}`);
  }
  return count;
};

/**
 * The stage's caption translation settings: local dev's own values, else
 * the `captionTranslation.Settings` deploy-time setting with the language
 * limit clamped to 0..9. Throws when the setting is missing or malformed, as
 * every deploy-time setting does.
 */
export const resolveCaptionTranslationSettings =
  async (): Promise<CaptionTranslationSettings> => {
    if (isLocalDev()) {
      return { ...LOCAL_CAPTION_TRANSLATION };
    }
    const value = readSetting('captionTranslation', 'Settings', [
      'enabled',
      'maxLanguagesPerCourse',
    ]);
    const max = parseCount(
      settingEnvName('captionTranslation', 'Settings', 'maxLanguagesPerCourse'),
      value.maxLanguagesPerCourse,
    );
    return {
      enabled: parseFlag(
        settingEnvName('captionTranslation', 'Settings', 'enabled'),
        value.enabled,
      ),
      maxLanguagesPerCourse: Math.min(
        MAX_CAPTION_LANGUAGES,
        Math.max(0, Math.trunc(max)),
      ),
    };
  };
