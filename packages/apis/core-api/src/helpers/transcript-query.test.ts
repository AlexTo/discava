/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  buildTranscriptSearchRequest,
  MATCH_END,
  MATCH_START,
} from './transcript-query.js';

const base = {
  courseId: 'c1',
  contentItemIds: ['i1', 'i2'],
  q: 'gradient descent',
};

describe('buildTranscriptSearchRequest', () => {
  it('builds the whole body without a language', () => {
    expect(buildTranscriptSearchRequest(base)).toEqual({
      size: 40,
      track_total_hits: false,
      _source: [
        'contentItemId',
        'versionId',
        'trackId',
        'language',
        'text',
        'cues',
      ],
      query: {
        bool: {
          filter: [
            { term: { courseId: 'c1' } },
            { terms: { contentItemId: ['i1', 'i2'] } },
            { term: { isDefault: true } },
          ],
          must: {
            multi_match: {
              query: 'gradient descent',
              fields: ['text', 'text.english'],
              type: 'most_fields',
              operator: 'and',
            },
          },
          should: [
            { match_phrase: { text: { query: 'gradient descent', slop: 2 } } },
          ],
        },
      },
      highlight: {
        number_of_fragments: 0,
        pre_tags: [MATCH_START],
        post_tags: [MATCH_END],
        fields: { text: {}, 'text.english': {} },
      },
      sort: ['_score', { startSeconds: 'asc' }, { contentItemId: 'asc' }],
    });
  });

  it('chooses the language, or the default track when a video has none', () => {
    const { filter } = buildTranscriptSearchRequest({
      ...base,
      language: 'es',
    }).query.bool;
    expect(filter[2]).toEqual({
      bool: {
        should: [
          { term: { language: 'es' } },
          {
            bool: {
              filter: [{ term: { isDefault: true } }],
              must_not: [{ term: { trackLanguages: 'es' } }],
            },
          },
        ],
        minimum_should_match: 1,
      },
    });
  });

  it.each([
    ['plain words', undefined],
    ['query syntax', 'es'],
  ])(
    'always filters on course and videos, and passes q as text: %s',
    (q, language) => {
      const text = q === 'query syntax' ? 'a OR (b" AND *:*' : q;
      const body = buildTranscriptSearchRequest({ ...base, q: text, language });
      expect(body.query.bool.filter).toContainEqual({
        term: { courseId: 'c1' },
      });
      expect(body.query.bool.filter).toContainEqual({
        terms: { contentItemId: ['i1', 'i2'] },
      });
      expect(body.query.bool.must.multi_match.query).toBe(text);
      expect(body.query.bool.should[0]!.match_phrase.text.query).toBe(text);
    },
  );
});
