/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  categoryWrites,
  InvalidRequestError,
  NameConflictError,
  NotFoundError,
  SlugUnavailableError,
  VersionConflictError,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { v7 as uuidv7 } from 'uuid';
import { adminProcedure } from '../init.js';
import {
  ArchiveCategoryInputSchema,
  CategorySchema,
  CreateCategoryInputSchema,
  ListCategoriesOutputSchema,
  RenameCategoryInputSchema,
} from '../schema/index.js';

type StoredCategory = {
  categoryId: string;
  name: string;
  slug: string;
  status: 'active' | 'archived';
};

const toCategory = ({ categoryId, name, slug, status }: StoredCategory) => ({
  id: categoryId,
  name,
  slug,
  status,
});

// What categoryWrites throws, as the contract's error codes.
const asTrpcError = (error: unknown) => {
  if (error instanceof InvalidRequestError) {
    return new TRPCError({ code: 'BAD_REQUEST', message: error.message });
  }
  if (error instanceof NotFoundError) {
    return new TRPCError({ code: 'NOT_FOUND', message: error.message });
  }
  if (
    error instanceof NameConflictError ||
    error instanceof SlugUnavailableError ||
    error instanceof VersionConflictError
  ) {
    return new TRPCError({ code: 'CONFLICT', message: error.message });
  }
  return error;
};

/**
 * Every category, archived ones included, with how many courses have it
 * whatever their status, so an admin sees what archiving affects.
 */
export const listCategories = adminProcedure
  .output(ListCategoriesOutputSchema)
  .query(async ({ ctx }) => {
    const coreTable = ctx.coreTable!;
    const [{ data: categories }, { data: courses }] = await Promise.all([
      coreTable.entities.category.query.primary({}).go({ pages: 'all' }),
      coreTable.entities.course.scan.go({ pages: 'all' }),
    ]);

    const courseCounts = new Map<string, number>();
    for (const { categoryId } of courses) {
      if (categoryId) {
        courseCounts.set(categoryId, (courseCounts.get(categoryId) ?? 0) + 1);
      }
    }

    return categories
      .map((category) => ({
        ...toCategory(category),
        courseCount: courseCounts.get(category.categoryId) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

export const createCategory = adminProcedure
  .input(CreateCategoryInputSchema)
  .output(CategorySchema)
  .mutation(async ({ ctx, input }) => {
    try {
      return toCategory(
        await categoryWrites.create(ctx.coreTable!, {
          categoryId: uuidv7(),
          name: input.name,
        }),
      );
    } catch (error) {
      throw asTrpcError(error);
    }
  });

export const renameCategory = adminProcedure
  .input(RenameCategoryInputSchema)
  .output(CategorySchema)
  .mutation(async ({ ctx, input }) => {
    try {
      return toCategory(
        await categoryWrites.rename(ctx.coreTable!, {
          categoryId: input.id,
          name: input.name,
        }),
      );
    } catch (error) {
      throw asTrpcError(error);
    }
  });

export const archiveCategory = adminProcedure
  .input(ArchiveCategoryInputSchema)
  .output(CategorySchema)
  .mutation(async ({ ctx, input }) => {
    try {
      return toCategory(
        await categoryWrites.archive(ctx.coreTable!, { categoryId: input.id }),
      );
    } catch (error) {
      throw asTrpcError(error);
    }
  });
