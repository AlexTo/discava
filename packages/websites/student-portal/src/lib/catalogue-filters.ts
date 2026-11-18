/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// The catalogue's filters as the address holds them (search params), so a
// reload or a shared link restores them. Only this portal shows filters, so
// the module lives here rather than in common-web-utils.

export const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'newest', label: 'Newest' },
] as const;
export type CatalogueSort = (typeof SORT_OPTIONS)[number]['value'];

export const MIN_RATING_OPTIONS = [
  { value: 4.5, label: '4.5 and up' },
  { value: 4, label: '4.0 and up' },
  { value: 3.5, label: '3.5 and up' },
  { value: 3, label: '3.0 and up' },
] as const;
export type CatalogueMinRating = (typeof MIN_RATING_OPTIONS)[number]['value'];

export interface CatalogueFilters {
  // A category's slug: what links and addresses use.
  category?: string;
  tags: string[];
  levels: string[];
  languages: string[];
  durations: string[];
  // Absent means the default: relevance, any rating.
  sort?: Exclude<CatalogueSort, 'relevance'>;
  minRating?: CatalogueMinRating;
}

export const NO_FILTERS: CatalogueFilters = {
  tags: [],
  levels: [],
  languages: [],
  durations: [],
};

const listOf = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : [value];
  return values.filter(
    (item): item is string => typeof item === 'string' && item !== '',
  );
};

/** The filters in a set of search params; anything else is ignored. */
export const parseCatalogueFilters = (
  search: Record<string, unknown>,
): CatalogueFilters => ({
  ...(typeof search.category === 'string' &&
    search.category !== '' && { category: search.category }),
  tags: listOf(search.tags),
  levels: listOf(search.levels),
  languages: listOf(search.languages),
  durations: listOf(search.durations),
  ...(search.sort === 'rating' || search.sort === 'newest'
    ? { sort: search.sort }
    : {}),
  // The router parses a numeric param to a number; a hand-typed address may
  // hold the text.
  ...(MIN_RATING_OPTIONS.some(({ value }) => value === Number(search.minRating))
    ? { minRating: Number(search.minRating) as CatalogueMinRating }
    : {}),
});

/** The search params for some filters: only those that are set. */
export const catalogueFiltersToSearch = (filters: CatalogueFilters) => ({
  ...(filters.category && { category: filters.category }),
  ...(filters.tags.length > 0 && { tags: filters.tags }),
  ...(filters.levels.length > 0 && { levels: filters.levels }),
  ...(filters.languages.length > 0 && { languages: filters.languages }),
  ...(filters.durations.length > 0 && { durations: filters.durations }),
  ...(filters.sort && { sort: filters.sort }),
  ...(filters.minRating !== undefined && { minRating: filters.minRating }),
});

export const hasCatalogueFilters = (filters: CatalogueFilters) =>
  Object.keys(catalogueFiltersToSearch(filters)).length > 0;

/** The course.publicSearch input for some filters. */
export const catalogueFiltersToInput = (
  filters: CatalogueFilters,
  categoryId?: string,
) => ({
  ...(categoryId && { categoryId }),
  ...(filters.tags.length > 0 && { tags: filters.tags }),
  ...(filters.levels.length > 0 && { levels: filters.levels }),
  ...(filters.languages.length > 0 && { languages: filters.languages }),
  ...(filters.durations.length > 0 && { durationBands: filters.durations }),
  ...(filters.sort && { sort: filters.sort }),
  ...(filters.minRating !== undefined && { minRating: filters.minRating }),
});

export const LEVEL_LABELS: Record<string, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  zh: 'Chinese',
  ja: 'Japanese',
  hi: 'Hindi',
  ar: 'Arabic',
};

export const DURATION_LABELS: Record<string, string> = {
  lt2: 'Under 2 hours',
  '2to10': '2 to 10 hours',
  '10to40': 'Over 10 to 40 hours',
  gt40: 'Over 40 hours',
};

export const formatDuration = (hours: number) =>
  `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
