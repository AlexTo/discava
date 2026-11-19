/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ISuggestCoursesInput } from '../schema/index.js';

/**
 * The request for the search box's suggestions: published courses whose title
 * starts with each typed word (the last one as a prefix), best match first.
 * The text goes in as plain query text, never as query syntax.
 */
export const buildSuggestRequest = (input: ISuggestCoursesInput) => ({
  size: 10,
  track_total_hits: false,
  _source: ['courseId', 'title', 'imageKey'],
  query: {
    function_score: {
      query: {
        bool: {
          must: { match_bool_prefix: { title: { query: input.q } } },
          filter: [{ term: { status: 'published' } }],
        },
      },
      field_value_factor: { field: 'ratingBoost', missing: 1 },
      boost_mode: 'multiply',
    },
  },
  sort: ['_score', { publishedAt: 'desc' }, { courseId: 'asc' }],
});
