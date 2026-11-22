/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { resolveCaptionTranslationSettings } = await import(
  './caption-translation-settings.js'
);

const stubSetting = (value: unknown) =>
  vi.stubEnv('DISCAVA_CAPTION_TRANSLATION_SETTINGS', JSON.stringify(value));

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.LOCAL_DEV;
});

describe('resolveCaptionTranslationSettings', () => {
  it('returns the local values under LOCAL_DEV without reading config', async () => {
    process.env.LOCAL_DEV = 'true';
    vi.stubEnv('DISCAVA_CAPTION_TRANSLATION_SETTINGS', '{not json');
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

  it('is off when the setting is absent', async () => {
    expect(await resolveCaptionTranslationSettings()).toEqual({
      enabled: false,
      maxLanguagesPerCourse: 0,
    });
  });

  it('is off when the setting is not valid JSON', async () => {
    vi.stubEnv('DISCAVA_CAPTION_TRANSLATION_SETTINGS', '{not json');
    expect(await resolveCaptionTranslationSettings()).toEqual({
      enabled: false,
      maxLanguagesPerCourse: 0,
    });
  });
});
