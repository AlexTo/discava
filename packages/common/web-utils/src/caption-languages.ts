/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/** The languages a video's captions can be in: BCP 47 tag and display label. */
export const CAPTION_LANGUAGES = [
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
] as const;

export type CaptionLanguageTag = (typeof CAPTION_LANGUAGES)[number]['tag'];

/** Whether a value is one of the listed language tags. */
export const isCaptionLanguage = (tag: unknown): tag is CaptionLanguageTag =>
  CAPTION_LANGUAGES.some((language) => language.tag === tag);

/** The display label for a tag, or the tag itself when it isn't listed. */
export const captionLabel = (tag: string): string =>
  CAPTION_LANGUAGES.find((language) => language.tag === tag)?.label ?? tag;
