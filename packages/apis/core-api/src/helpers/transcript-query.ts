/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// The two characters OpenSearch wraps a match in (private-use code points the
// transcripts never contain; the indexer and the parser strip them).
export const MATCH_START = '';
export const MATCH_END = '';

interface ITranscriptQueryInput {
  courseId: string;
  contentItemIds: string[];
  q: string;
  language?: string;
}

// The passage search of a course's transcripts. `q` goes in as query text,
// never as query syntax. Reused by a later lesson-scoped retrieval, which
// narrows `contentItemIds` to one lesson's.
export const buildTranscriptSearchRequest = ({
  courseId,
  contentItemIds,
  q,
  language,
}: ITranscriptQueryInput) => ({
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
        { term: { courseId } },
        { terms: { contentItemId: contentItemIds } },
        language
          ? {
              bool: {
                should: [
                  { term: { language } },
                  {
                    bool: {
                      filter: [{ term: { isDefault: true } }],
                      must_not: [{ term: { trackLanguages: language } }],
                    },
                  },
                ],
                minimum_should_match: 1,
              },
            }
          : { term: { isDefault: true } },
      ],
      must: {
        multi_match: {
          query: q,
          fields: ['text', 'text.english'],
          type: 'most_fields',
          operator: 'and',
        },
      },
      should: [{ match_phrase: { text: { query: q, slop: 2 } } }],
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
