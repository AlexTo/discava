/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  courseCatalogueWrites,
  InvalidRequestError,
  NotFoundError,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import { requireCourseInstructor } from '../lib/course-lifecycle.js';
import {
  ListActiveCategoriesOutputSchema,
  UpdateCourseCatalogueInputSchema,
  UpdateCourseCatalogueOutputSchema,
} from '../schema/index.js';

/**
 * Sets a course's category, tags, level, language and duration, replacing the
 * lot (a field left out is cleared). Allowed on a course in any status; for a
 * published one the stream indexer updates its search entry.
 */
export const updateCourseCatalogue = courseProcedure
  .input(UpdateCourseCatalogueInputSchema)
  .output(UpdateCourseCatalogueOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, ...catalogue } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);

    try {
      await courseCatalogueWrites(coreTable, { courseId, ...catalogue });
    } catch (error) {
      if (error instanceof InvalidRequestError) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      }
      if (error instanceof NotFoundError) {
        throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
      }
      throw error;
    }

    const { data: course } = await coreTable.entities.course
      .get({ courseId })
      .go();
    if (!course) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    return course;
  });

/** The active categories, for the course form's picker. */
export const listActiveCategories = courseProcedure
  .output(ListActiveCategoriesOutputSchema)
  .query(async ({ ctx }) => {
    const { data } = await ctx.coreTable.entities.category.query
      .primary({})
      .go({ pages: 'all' });
    return data
      .filter((category) => category.status === 'active')
      .map(({ categoryId, name }) => ({ id: categoryId, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
