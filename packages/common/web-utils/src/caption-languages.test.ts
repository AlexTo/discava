/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  CAPTION_LANGUAGES,
  captionLabel,
  captionNativeLabel,
  isCaptionLanguage,
} from './caption-languages';

describe('CAPTION_LANGUAGES', () => {
  it('is exactly the ten supported languages, in order', () => {
    expect(CAPTION_LANGUAGES).toEqual([
      { tag: 'en-US', label: 'English', nativeLabel: 'English' },
      { tag: 'es-ES', label: 'Spanish', nativeLabel: 'Español' },
      { tag: 'fr-FR', label: 'French', nativeLabel: 'Français' },
      { tag: 'de-DE', label: 'German', nativeLabel: 'Deutsch' },
      { tag: 'pt-BR', label: 'Portuguese', nativeLabel: 'Português' },
      { tag: 'ja-JP', label: 'Japanese', nativeLabel: '日本語' },
      { tag: 'zh-CN', label: 'Chinese', nativeLabel: '中文' },
      { tag: 'hi-IN', label: 'Hindi', nativeLabel: 'हिन्दी' },
      { tag: 'ar-SA', label: 'Arabic', nativeLabel: 'العربية' },
      { tag: 'vi-VN', label: 'Vietnamese', nativeLabel: 'Tiếng Việt' },
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

describe('captionNativeLabel', () => {
  it('has a non-empty native label for every entry', () => {
    for (const language of CAPTION_LANGUAGES) {
      expect(language.nativeLabel.length).toBeGreaterThan(0);
    }
  });

  it('gives the native label of a listed tag', () => {
    expect(captionNativeLabel('es-ES')).toBe('Español');
    expect(captionNativeLabel('ja-JP')).toBe('日本語');
  });

  it('falls back to the tag itself for an unlisted one', () => {
    expect(captionNativeLabel('ko-KR')).toBe('ko-KR');
  });
});
