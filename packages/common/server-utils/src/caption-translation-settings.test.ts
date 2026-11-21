/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveAppConfigValue = vi.fn();
vi.mock('./lesson-media-bucket.js', () => ({ resolveAppConfigValue }));

const { resolveCaptionTranslationSettings } = await import(
  './caption-translation-settings.js'
);

beforeEach(() => {
  resolveAppConfigValue.mockReset();
});
afterEach(() => {
  delete process.env.LOCAL_DEV;
});

describe('resolveCaptionTranslationSettings', () => {
  it('returns the local values under LOCAL_DEV without reading config', async () => {
    process.env.LOCAL_DEV = 'true';
    expect(await resolveCaptionTranslationSettings()).toEqual({
      enabled: true,
      maxLanguagesPerCourse: 9,
    });
    expect(resolveAppConfigValue).not.toHaveBeenCalled();
  });

  it('returns the published value', async () => {
    resolveAppConfigValue.mockResolvedValue({
      enabled: true,
      maxLanguagesPerCourse: 3,
    });
    expect(await resolveCaptionTranslationSettings()).toEqual({
      enabled: true,
      maxLanguagesPerCourse: 3,
    });
    expect(resolveAppConfigValue).toHaveBeenCalledWith(
      'captionTranslation',
      'Settings',
    );
  });

  it('reads enabled: false as it is', async () => {
    resolveAppConfigValue.mockResolvedValue({
      enabled: false,
      maxLanguagesPerCourse: 5,
    });
    expect((await resolveCaptionTranslationSettings()).enabled).toBe(false);
  });

  it.each([
    [20, 9],
    [-2, 0],
    [4.7, 4],
  ])('clamps %s to %s', async (given, expected) => {
    resolveAppConfigValue.mockResolvedValue({
      enabled: true,
      maxLanguagesPerCourse: given,
    });
    expect(
      (await resolveCaptionTranslationSettings()).maxLanguagesPerCourse,
    ).toBe(expected);
  });

  it('falls back to off when the value cannot be read', async () => {
    resolveAppConfigValue.mockRejectedValue(new Error('no config'));
    expect(await resolveCaptionTranslationSettings()).toEqual({
      enabled: false,
      maxLanguagesPerCourse: 0,
    });
  });
});
