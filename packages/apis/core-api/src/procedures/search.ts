/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ICourseDocument, resolveIndexName } from '@discava/search';
import { searchProcedure } from '../init.js';
import {
  SearchCoursesInputSchema,
  SearchCoursesOutputSchema,
} from '../schema/index.js';

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
    const { body } = await search.search({
      index: resolveIndexName('courses'),
      body: {
        from,
        size: input.limit,
        query: {
          bool: {
            must: {
              multi_match: { query: input.q, fields: ['title', 'description'] },
            },
            filter: [{ term: { status: 'published' } }],
          },
        },
      },
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
