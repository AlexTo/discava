/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ISearchCoursesInput } from '../schema/index.js';

// The facets and the document field each filters on.
const FIELDS = {
  categories: 'categoryId',
  tags: 'tags',
  levels: 'level',
  languages: 'language',
  durationBands: 'durationHours',
} as const;
type Facet = keyof typeof FIELDS;

// Whole hours. A band's `to` is exclusive, so the integer 10 is in 2to10 and
// 11 in 10to40: "under 2, 2 to 10, over 10 to 40, over 40" with no gap.
const DURATION_RANGES = [
  { key: 'lt2', to: 2 },
  { key: '2to10', from: 2, to: 11 },
  { key: '10to40', from: 11, to: 41 },
  { key: 'gt40', from: 41 },
];

const durationClause = (bands: string[]) => ({
  bool: {
    should: bands.map((band) => {
      const range = DURATION_RANGES.find(({ key }) => key === band);
      return range
        ? {
            range: {
              durationHours: {
                ...(range.from !== undefined && { gte: range.from }),
                ...(range.to !== undefined && { lt: range.to }),
              },
            },
          }
        : { match_none: {} };
    }),
    minimum_should_match: 1,
  },
});

// Each facet's filter clause, for the filters the caller set.
const clausesOf = (input: ISearchCoursesInput) => {
  const clauses: Partial<Record<Facet, object>> = {};
  if (input.categoryId !== undefined) {
    clauses.categories = { terms: { categoryId: [input.categoryId] } };
  }
  if (input.tags?.length) {
    clauses.tags = { terms: { tags: input.tags } };
  }
  if (input.levels?.length) {
    clauses.levels = { terms: { level: input.levels } };
  }
  if (input.languages?.length) {
    clauses.languages = { terms: { language: input.languages } };
  }
  if (input.durationBands?.length) {
    clauses.durationBands = durationClause(input.durationBands);
  }
  return clauses;
};

// The text query, or every course. Under the default sort a text query's
// score is multiplied by the course's rating boost (1 when it has none), so
// a well-rated course ranks above an equally relevant poorly rated one.
const textQueryOf = (input: ISearchCoursesInput) => {
  if (!input.q) {
    return { match_all: {} };
  }
  const text = {
    multi_match: {
      query: input.q,
      fields: ['title', 'description'],
      // Any word may match (in title or description); more
      // matching words rank higher.
      type: 'cross_fields',
    },
  };
  return input.sort !== 'rating' && input.sort !== 'newest'
    ? {
        function_score: {
          query: text,
          field_value_factor: { field: 'ratingBoost', missing: 1 },
          boost_mode: 'multiply',
        },
      }
    : text;
};

// With the id as the last key so a page boundary is stable.
const sortOf = (input: ISearchCoursesInput) => {
  switch (input.sort) {
    case 'rating':
      return [
        { ratingScore: { order: 'desc', missing: '_last' } },
        { publishedAt: 'desc' },
        { courseId: 'asc' },
      ];
    case 'newest':
      return [{ publishedAt: 'desc' }, { courseId: 'asc' }];
    default:
      // Without text there is no relevance: newest published first.
      return input.q
        ? undefined
        : [{ publishedAt: 'desc' }, { courseId: 'asc' }];
  }
};

const filterOf = (clauses: object[]) =>
  clauses.length > 0 ? { bool: { filter: clauses } } : { match_all: {} };

/**
 * The search request body for the catalogue: the text query (or every
 * published course) in `query`, every user filter in `post_filter` so the
 * hits are fully filtered, and one `filter` aggregation per facet holding
 * every filter except its own, so each count is what picking that value
 * instead would give. See research R-3 of the catalogue spec.
 */
export const buildSearchRequest = (input: ISearchCoursesInput) => {
  const clauses = clausesOf(input);
  const all = Object.values(clauses);
  const sort = sortOf(input);

  const facet = (name: Facet, values: object) => ({
    filter: filterOf(
      Object.entries(clauses)
        .filter(([other]) => other !== name)
        .map(([, clause]) => clause),
    ),
    aggs: { values },
  });

  return {
    from: input.cursor ?? 0,
    size: input.limit,
    query: {
      bool: {
        must: textQueryOf(input),
        filter: [
          { term: { status: 'published' } },
          // In the query, not post_filter, so every facet count respects it.
          ...(input.minRating !== undefined
            ? [{ range: { ratingAverage: { gte: input.minRating } } }]
            : []),
        ],
      },
    },
    ...(sort && { sort }),
    ...(all.length > 0 && { post_filter: { bool: { filter: all } } }),
    aggs: {
      // The taxonomy is bounded at 500, so every category is listed, not the
      // default 10.
      categories: facet('categories', {
        terms: { field: FIELDS.categories, size: 500 },
      }),
      tags: facet('tags', { terms: { field: FIELDS.tags, size: 20 } }),
      levels: facet('levels', { terms: { field: FIELDS.levels, size: 10 } }),
      languages: facet('languages', {
        terms: { field: FIELDS.languages, size: 20 },
      }),
      durationBands: facet('durationBands', {
        range: { field: FIELDS.durationBands, ranges: DURATION_RANGES },
      }),
    },
  };
};
