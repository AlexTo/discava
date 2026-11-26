/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { resolveIndexName } from '@discava/search';
import { TRPCError } from '@trpc/server';
import { readCategories } from '../helpers/category-list.js';
import { timed } from '../helpers/timing.js';
import { publicCourseProcedure, publicSearchProcedure } from '../init.js';
import {
  CategoryBySlugInputSchema,
  CategoryBySlugOutputSchema,
  ListCategoriesOutputSchema,
} from '../schema/index.js';
import { mapSearchError, SEARCH_REQUEST_TIMEOUT_MS } from './search.js';

// The taxonomy is bounded at 500 categories; the terms aggregation's default
// of 10 buckets would drop the rest.
const MAX_CATEGORIES = 500;

/**
 * The active categories with how many published courses each has, sorted by
 * name. The list comes from the category records, so a category with no
 * courses is still listed; the counts from one size-0 aggregation are merged
 * in.
 */
export const listCategories = publicSearchProcedure
  .output(ListCategoriesOutputSchema)
  .query(async ({ ctx }) => {
    const [categories, { body }] = await Promise.all([
      timed('category.list: categories', readCategories(ctx.coreTable)),
      timed(
        'category.list: opensearch',
        ctx
          .search!.search(
            {
              index: resolveIndexName('courses'),
              body: {
                size: 0,
                query: {
                  bool: { filter: [{ term: { status: 'published' } }] },
                },
                aggs: {
                  categories: {
                    terms: { field: 'categoryId', size: MAX_CATEGORIES },
                  },
                },
              } as never,
            },
            // As course.publicSearch: stop waiting on a collection that is
            // waking up before the Lambda's own timeout turns it into a 502.
            { requestTimeout: SEARCH_REQUEST_TIMEOUT_MS, maxRetries: 0 },
          )
          .catch(mapSearchError),
      ),
    ]);

    const counts = new Map(
      (
        ((body.aggregations?.categories as { buckets?: unknown } | undefined)
          ?.buckets ?? []) as {
          key: string;
          doc_count: number;
        }[]
      ).map((bucket) => [bucket.key, bucket.doc_count]),
    );
    return categories
      .filter((category) => category.status === 'active')
      .map((category) => ({
        id: category.categoryId,
        name: category.name,
        slug: category.slug,
        courseCount: counts.get(category.categoryId) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

/**
 * A category by its slug, for the landing page. An archived category is
 * returned with its status so the page can say it is no longer available.
 */
export const categoryBySlug = publicCourseProcedure
  .input(CategoryBySlugInputSchema)
  .output(CategoryBySlugOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { data: claim } = await coreTable.entities.categoryClaim
      .get({ claim: `slug#${input.slug}` })
      .go();
    const { data: category } = claim
      ? await coreTable.entities.category
          .get({ categoryId: claim.categoryId })
          .go()
      : { data: null };
    if (!category) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Category not found' });
    }
    return {
      id: category.categoryId,
      name: category.name,
      slug: category.slug,
      status: category.status,
    };
  });
