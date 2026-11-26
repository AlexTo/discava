/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { resolveCaptionTranslationSettings } = await import(
  './caption-translation-settings.js'
);

const NAME = 'DISCAVA_CAPTION_TRANSLATION_SETTINGS';

const stubSetting = (value: {
  enabled: unknown;
  maxLanguagesPerCourse: unknown;
}) => {
  vi.stubEnv(`${NAME}_ENABLED`, String(value.enabled));
  vi.stubEnv(
    `${NAME}_MAX_LANGUAGES_PER_COURSE`,
    String(value.maxLanguagesPerCourse),
  );
};

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.LOCAL_DEV;
});

describe('resolveCaptionTranslationSettings', () => {
  it('returns the local values under LOCAL_DEV without reading config', async () => {
    process.env.LOCAL_DEV = 'true';
    vi.stubEnv(`${NAME}_ENABLED`, 'nonsense');
    expect(await resolveCaptionTranslationSettings()).toEqual({
      enabled: true,
      maxLanguagesPerCourse: 9,
    });
  });

  it('returns the published value', async () => {
    stubSetting({ enabled: true, maxLanguagesPerCourse: 3 });
    expect(await resolveCaptionTranslationSettings()).toEqual({
      enabled: true,
      maxLanguagesPerCourse: 3,
    });
  });

  it('reads enabled: false as it is', async () => {
    stubSetting({ enabled: false, maxLanguagesPerCourse: 5 });
    expect((await resolveCaptionTranslationSettings()).enabled).toBe(false);
  });

  it.each([
    [20, 9],
    [-2, 0],
    [4.7, 4],
  ])('clamps %s to %s', async (given, expected) => {
    stubSetting({ enabled: true, maxLanguagesPerCourse: given });
    expect(
      (await resolveCaptionTranslationSettings()).maxLanguagesPerCourse,
    ).toBe(expected);
  });

  it('throws naming the variable when the setting is absent', async () => {
    await expect(resolveCaptionTranslationSettings()).rejects.toThrow(
      `Missing deploy-time setting ${NAME}_ENABLED`,
    );
  });

  it('throws naming the variable when the limit is absent', async () => {
    vi.stubEnv(`${NAME}_ENABLED`, 'true');
    await expect(resolveCaptionTranslationSettings()).rejects.toThrow(
      `Missing deploy-time setting ${NAME}_MAX_LANGUAGES_PER_COURSE`,
    );
  });

  it.each([
    ['enabled', 'yes', 3],
    ['maxLanguagesPerCourse', true, 'many'],
  ])('throws when %s does not parse', async (_field, enabled, max) => {
    stubSetting({ enabled, maxLanguagesPerCourse: max });
    await expect(resolveCaptionTranslationSettings()).rejects.toThrow(
      /Invalid deploy-time setting DISCAVA_CAPTION_TRANSLATION_SETTINGS_/,
    );
  });
});
