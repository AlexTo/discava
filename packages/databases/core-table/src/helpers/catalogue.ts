/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { InvalidRequestError } from './errors.js';

// The catalogue's controlled vocabularies and the normalisation of what
// instructors and admins type, shared by every writer of a category or a
// course's catalogue fields.

export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type Level = (typeof LEVELS)[number];

export const LANGUAGES = [
  'en',
  'es',
  'fr',
  'de',
  'pt',
  'zh',
  'ja',
  'hi',
  'ar',
] as const;
export type Language = (typeof LANGUAGES)[number];

export const TAG_MAX_LENGTH = 30;
export const MAX_TAGS = 8;
export const CATEGORY_NAME_MAX_LENGTH = 60;
export const DURATION_HOURS_MIN = 1;
export const DURATION_HOURS_MAX = 500;

const collapse = (text: string) => text.trim().replace(/\s+/g, ' ');

/**
 * Tags as stored: trimmed, inner spaces collapsed, lower-cased and
 * de-duplicated (keeping the first). Throws InvalidRequestError for a tag
 * that is empty or over 30 characters, or more than 8 distinct tags: an
 * over-limit input is an error, not truncated.
 */
export const normaliseTags = (tags: readonly string[]): string[] => {
  const normalised = [
    ...new Set(tags.map((tag) => collapse(tag).toLowerCase())),
  ];
  for (const tag of normalised) {
    if (tag.length < 1 || tag.length > TAG_MAX_LENGTH) {
      throw new InvalidRequestError(
        `A tag must be 1 to ${TAG_MAX_LENGTH} characters`,
      );
    }
  }
  if (normalised.length > MAX_TAGS) {
    throw new InvalidRequestError(`A course can have at most ${MAX_TAGS} tags`);
  }
  return normalised;
};

/**
 * A category name as shown: trimmed with inner spaces collapsed. Names are
 * compared case-insensitively (see categoryNameKey). Throws
 * InvalidRequestError unless it is 1 to 60 characters.
 */
export const normaliseCategoryName = (name: string): string => {
  const normalised = collapse(name);
  if (normalised.length < 1 || normalised.length > CATEGORY_NAME_MAX_LENGTH) {
    throw new InvalidRequestError(
      `A category name must be 1 to ${CATEGORY_NAME_MAX_LENGTH} characters`,
    );
  }
  return normalised;
};

/** What two names are compared by: the normalised name, lower-cased. */
export const categoryNameKey = (name: string): string =>
  normaliseCategoryName(name).toLowerCase();

/**
 * The slug a category name gives: lower case, accents folded, every run of
 * other characters a single `-`, none leading or trailing. Throws
 * InvalidRequestError when nothing URL-safe remains.
 */
export const categorySlug = (name: string): string => {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug === '') {
    throw new InvalidRequestError(
      'A category name needs at least one letter or digit',
    );
  }
  return slug;
};
