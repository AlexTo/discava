/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '@discava/core-table';
import { resolveIndexName } from '@discava/search';
import { searchProcedure } from '../init.js';
import {
  type ISearchHit,
  SearchQueryInputSchema,
  SearchQueryOutputSchema,
} from '../schema/index.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// Courses a student may search their own lessons within: enrolled and not
// dropped, the same rule requireEnrolment applies to viewCourse.
const listEnrolledCourseIds = async (
  coreTable: CoreTable,
  userId: string,
): Promise<string[]> => {
  const { data } = await coreTable.entities.enrolment.query
    .byUser({ userId })
    .go({ pages: 'all', attributes: ['courseId', 'status'] });
  return data
    .filter((enrolment) => enrolment.status !== 'dropped')
    .map((enrolment) => enrolment.courseId);
};

interface SearchHitSource {
  courseId: string;
  title: string;
  description?: string;
  lessonId?: string;
  moduleId?: string;
}

const asHit = (
  index: string,
  coursesIndexName: string,
  source: SearchHitSource,
): ISearchHit =>
  index === coursesIndexName
    ? {
        type: 'course',
        courseId: source.courseId,
        title: source.title,
        ...(source.description && { description: source.description }),
      }
    : {
        type: 'lesson',
        lessonId: source.lessonId!,
        moduleId: source.moduleId!,
        courseId: source.courseId,
        title: source.title,
        ...(source.description && { description: source.description }),
      };

/**
 * One query across content types (#53): courses, and (for a signed-in
 * student) lessons in courses they're enrolled in. Visibility is enforced
 * twice -- once when a document is indexed (index-content.ts never indexes
 * a hidden/draft/archived one) and again here, in the query itself, by
 * scoping courses to `status: 'published'` and lessons to the caller's own
 * enrolled course ids (an anonymous caller, or one not yet in any course,
 * gets lessons excluded from the query entirely rather than filtered after
 * the fact).
 */
export const query = searchProcedure
  .input(SearchQueryInputSchema)
  .output(SearchQueryOutputSchema)
  .query(async ({ ctx, input }) => {
    const search = ctx.search!;
    const coursesIndexName = resolveIndexName('courses');
    const lessonsIndexName = resolveIndexName('lessons');

    const enrolledCourseIds = ctx.user
      ? await listEnrolledCourseIds(ctx.coreTable!, ctx.user.sub)
      : [];
    const searchLessons = enrolledCourseIds.length > 0;

    const from = input.cursor ?? 0;
    const { body } = await search.search({
      index: searchLessons
        ? [coursesIndexName, lessonsIndexName]
        : [coursesIndexName],
      body: {
        from,
        size: input.limit,
        query: {
          bool: {
            must: {
              multi_match: { query: input.q, fields: ['title', 'description'] },
            },
            filter: {
              bool: {
                should: [
                  {
                    bool: {
                      filter: [
                        { term: { _index: coursesIndexName } },
                        { term: { status: 'published' } },
                      ],
                    },
                  },
                  ...(searchLessons
                    ? [
                        {
                          bool: {
                            filter: [
                              { term: { _index: lessonsIndexName } },
                              { terms: { courseId: enrolledCourseIds } },
                            ],
                          },
                        },
                      ]
                    : []),
                ],
              },
            },
          },
        },
      },
    });

    const hits = body.hits.hits as {
      _index: string;
      _source: SearchHitSource;
    }[];
    const total =
      typeof body.hits.total === 'number'
        ? body.hits.total
        : (body.hits.total?.value ?? hits.length);

    return {
      items: hits.map(({ _index, _source }) =>
        asHit(_index, coursesIndexName, _source),
      ),
      cursor: from + hits.length < total ? from + hits.length : null,
    };
  });
