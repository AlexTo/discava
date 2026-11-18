/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ICourseDocument, resolveIndexName } from '@discava/search';
import { errors as openSearchErrors } from '@opensearch-project/opensearch';
import { TRPCError } from '@trpc/server';
import { readCategories } from '../helpers/category-list.js';
import { buildSearchRequest } from '../helpers/search-query.js';
import { publicSearchProcedure } from '../init.js';
import {
  DURATION_BANDS,
  type ISearchCoursesInput,
  type ISearchFacets,
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

type Bucket = { key: string | number; doc_count: number };
type Aggregations = Record<string, { values?: { buckets?: Bucket[] } }>;

// A facet's values with counts: those with courses, plus every selected value
// even at zero so the caller can still see and clear it.
const valueCounts = (
  buckets: Bucket[] = [],
  selected: string[] = [],
  order?: readonly string[],
) => {
  const counts = new Map(
    buckets
      .filter((bucket) => bucket.doc_count > 0)
      .map((bucket) => [String(bucket.key), bucket.doc_count]),
  );
  for (const value of selected) {
    if (!counts.has(value)) {
      counts.set(value, 0);
    }
  }
  const values = [...counts].map(([value, count]) => ({ value, count }));
  return order
    ? values.sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value))
    : values;
};

const facetsOf = (
  aggregations: Aggregations,
  input: ISearchCoursesInput,
  categories: Awaited<ReturnType<typeof readCategories>>,
): ISearchFacets => {
  const active = new Map(
    categories
      .filter((category) => category.status === 'active')
      .map((category) => [category.categoryId, category]),
  );
  // Archived or unknown categories are dropped, even when selected.
  const categoryCounts = valueCounts(
    aggregations.categories?.values?.buckets,
    input.categoryId ? [input.categoryId] : [],
  ).flatMap(({ value, count }) => {
    const category = active.get(value);
    return category
      ? [{ id: value, name: category.name, slug: category.slug, count }]
      : [];
  });

  return {
    categories: categoryCounts,
    tags: valueCounts(aggregations.tags?.values?.buckets, input.tags),
    levels: valueCounts(aggregations.levels?.values?.buckets, input.levels),
    languages: valueCounts(
      aggregations.languages?.values?.buckets,
      input.languages,
    ),
    durationBands: valueCounts(
      aggregations.durationBands?.values?.buckets,
      input.durationBands,
      DURATION_BANDS,
    ),
  };
};

/**
 * Full-text search and browsing over published courses (#53), narrowed by
 * category, tags, level, language and duration, with counts for every facet.
 * Visibility is enforced twice -- once when a document is indexed
 * (index-content.ts never indexes a draft or archived course) and again
 * here, in the query itself, by filtering to `status: 'published'`.
 */
export const publicSearchCourses = publicSearchProcedure
  .input(SearchCoursesInputSchema)
  .output(SearchCoursesOutputSchema)
  .query(async ({ ctx, input }) => {
    const search = ctx.search!;
    const from = input.cursor ?? 0;
    const [{ body }, categories] = await Promise.all([
      search
        .search(
          {
            index: resolveIndexName('courses'),
            // The client's request types don't model every aggregation shape.
            body: buildSearchRequest(input) as never,
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
        }),
      readCategories(ctx.coreTable!),
    ]);

    const byId = new Map(
      categories.map((category) => [category.categoryId, category]),
    );
    const hits = body.hits.hits as { _source: ICourseDocument }[];
    const total =
      typeof body.hits.total === 'number'
        ? body.hits.total
        : (body.hits.total?.value ?? hits.length);

    return {
      items: hits.map(({ _source: doc }) => {
        const category = doc.categoryId ? byId.get(doc.categoryId) : undefined;
        return {
          courseId: doc.courseId,
          title: doc.title,
          ...(doc.description && { description: doc.description }),
          ...(doc.imageKey && { imageKey: doc.imageKey }),
          ...(category && {
            category: {
              id: category.categoryId,
              name: category.name,
              slug: category.slug,
            },
          }),
          tags: doc.tags ?? [],
          ...(doc.level && { level: doc.level }),
          ...(doc.language && { language: doc.language }),
          ...(doc.durationHours !== undefined && {
            durationHours: doc.durationHours,
          }),
          ...(doc.ratingAverage !== undefined && {
            ratingAverage: doc.ratingAverage,
          }),
          ratingCount: doc.ratingCount ?? 0,
        };
      }),
      cursor: from + hits.length < total ? from + hits.length : null,
      facets: facetsOf(
        (body.aggregations ?? {}) as Aggregations,
        input,
        categories,
      ),
    };
  });
