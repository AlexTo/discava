/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  CAPTION_LANGUAGES,
  captionLabel,
  isCaptionLanguage,
} from './caption-languages';

describe('CAPTION_LANGUAGES', () => {
  it('is exactly the ten supported languages, in order', () => {
    expect(CAPTION_LANGUAGES).toEqual([
      { tag: 'en-US', label: 'English' },
      { tag: 'es-ES', label: 'Spanish' },
      { tag: 'fr-FR', label: 'French' },
      { tag: 'de-DE', label: 'German' },
      { tag: 'pt-BR', label: 'Portuguese' },
      { tag: 'ja-JP', label: 'Japanese' },
      { tag: 'zh-CN', label: 'Chinese' },
      { tag: 'hi-IN', label: 'Hindi' },
      { tag: 'ar-SA', label: 'Arabic' },
      { tag: 'vi-VN', label: 'Vietnamese' },
    ]);
  });
});

describe('isCaptionLanguage', () => {
  it('accepts every listed tag', () => {
    for (const { tag } of CAPTION_LANGUAGES) {
      expect(isCaptionLanguage(tag)).toBe(true);
    }
  });

  it('rejects other tags, other cases and non-strings', () => {
    expect(isCaptionLanguage('en')).toBe(false);
    expect(isCaptionLanguage('en-us')).toBe(false);
    expect(isCaptionLanguage('ko-KR')).toBe(false);
    expect(isCaptionLanguage('')).toBe(false);
    expect(isCaptionLanguage(undefined)).toBe(false);
    expect(isCaptionLanguage(42)).toBe(false);
  });
});

describe('captionLabel', () => {
  it('gives the display label of a listed tag', () => {
    expect(captionLabel('en-US')).toBe('English');
    expect(captionLabel('vi-VN')).toBe('Vietnamese');
  });

  it('falls back to the tag itself for an unlisted one', () => {
    expect(captionLabel('ko-KR')).toBe('ko-KR');
  });
});
