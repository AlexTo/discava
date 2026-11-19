/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { buildSuggestRequest } from './suggest-query.js';

describe('buildSuggestRequest', () => {
  it('builds the whole request body', () => {
    expect(buildSuggestRequest({ q: 'pyth dat' })).toEqual({
      size: 10,
      track_total_hits: false,
      _source: ['courseId', 'title', 'imageKey'],
      query: {
        function_score: {
          query: {
            bool: {
              must: { match_bool_prefix: { title: { query: 'pyth dat' } } },
              filter: [{ term: { status: 'published' } }],
            },
          },
          field_value_factor: { field: 'ratingBoost', missing: 1 },
          boost_mode: 'multiply',
        },
      },
      sort: ['_score', { publishedAt: 'desc' }, { courseId: 'asc' }],
    });
  });

  it.each(['abc', 'title:"x" OR *', '(a AND b) -c'])(
    'always filters to published courses and passes %j as plain text',
    (q) => {
      const body = buildSuggestRequest({ q });

      expect(body.query.function_score.query.bool.filter).toEqual([
        { term: { status: 'published' } },
      ]);
      expect(
        body.query.function_score.query.bool.must.match_bool_prefix.title.query,
      ).toBe(q);
      expect(body).not.toHaveProperty('aggs');
    },
  );
});
