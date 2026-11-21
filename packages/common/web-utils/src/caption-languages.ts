/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/** The languages a video's captions can be in: BCP 47 tag, display label and the language's name in itself. */
export const CAPTION_LANGUAGES = [
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
] as const;

export type CaptionLanguageTag = (typeof CAPTION_LANGUAGES)[number]['tag'];

/** Whether a value is one of the listed language tags. */
export const isCaptionLanguage = (tag: unknown): tag is CaptionLanguageTag =>
  CAPTION_LANGUAGES.some((language) => language.tag === tag);

/** The display label for a tag, or the tag itself when it isn't listed. */
export const captionLabel = (tag: string): string =>
  CAPTION_LANGUAGES.find((language) => language.tag === tag)?.label ?? tag;

/** The language's own name for a tag, or the tag itself when it isn't listed. */
export const captionNativeLabel = (tag: string): string =>
  CAPTION_LANGUAGES.find((language) => language.tag === tag)?.nativeLabel ??
  tag;
