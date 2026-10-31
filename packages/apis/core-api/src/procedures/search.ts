/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ICourseDocument, resolveIndexName } from '@discava/search';
import { errors as openSearchErrors } from '@opensearch-project/opensearch';
import { TRPCError } from '@trpc/server';
import { searchProcedure } from '../init.js';
import {
  SearchCoursesInputSchema,
  SearchCoursesOutputSchema,
} from '../schema/index.js';

// A NextGen OpenSearch Serverless collection scales to zero after 10 minutes
// idle and takes 10-30s to wake (#267). The core-api Lambda's own timeout
// (10s in discava-development, bounding the cost of a flood with WAF off)
// is shorter than that, so without a timeout of its own the call would run
// the Lambda out of time and API Gateway would return a 502 with no useful
// message. Timing the request out first, with room to spare under the
// Lambda's budget, lets this return a clear, retriable error instead.
const SEARCH_REQUEST_TIMEOUT_MS = 8_000;

/**
 * Full-text search over published courses' titles and descriptions (#53).
 * Visibility is enforced twice -- once when a document is indexed
 * (index-content.ts never indexes a draft or archived course) and again
 * here, in the query itself, by filtering to `status: 'published'`.
 */
export const publicSearchCourses = searchProcedure
  .input(SearchCoursesInputSchema)
  .output(SearchCoursesOutputSchema)
  .query(async ({ ctx, input }) => {
    const search = ctx.search!;
    const from = input.cursor ?? 0;
    const { body } = await search
      .search(
        {
          index: resolveIndexName('courses'),
          body: {
            from,
            size: input.limit,
            query: {
              bool: {
                must: {
                  multi_match: {
                    query: input.q,
                    fields: ['title', 'description'],
                    // Every word must match (in title or description, in
                    // either order), matching the browser filter this
                    // replaces -- see search.tsx in student-portal.
                    operator: 'and',
                    type: 'cross_fields',
                  },
                },
                filter: [{ term: { status: 'published' } }],
              },
            },
          },
        },
        { requestTimeout: SEARCH_REQUEST_TIMEOUT_MS },
      )
      .catch((error: unknown) => {
        if (error instanceof openSearchErrors.TimeoutError) {
          throw new TRPCError({
            code: 'TIMEOUT',
            message: 'Search is starting up. Try again in a few seconds.',
            cause: error,
          });
        }
        throw error;
      });

    const hits = body.hits.hits as { _source: ICourseDocument }[];
    const total =
      typeof body.hits.total === 'number'
        ? body.hits.total
        : (body.hits.total?.value ?? hits.length);

    return {
      items: hits.map(({ _source: { courseId, title, description } }) => ({
        courseId,
        title,
        ...(description && { description }),
      })),
      cursor: from + hits.length < total ? from + hits.length : null,
    };
  });
