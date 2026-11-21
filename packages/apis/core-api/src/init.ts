/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type ApiBase,
  createApiBase,
} from '@discava/common-server-utils/trpc-api-base';
import {
  createCoreTablePlugin,
  IMiddlewareContext,
} from '@discava/common-server-utils/trpc-middleware';
import { createSearchPlugin, ISearchContext } from './middleware/search.js';

export type Context = IMiddlewareContext & ISearchContext;

const base = createApiBase({
  serviceName: 'CoreApi',
});

export const t: ApiBase['t'] = base.t;
export const publicProcedure: ApiBase['publicProcedure'] = base.publicProcedure;
export const protectedProcedure: ApiBase['protectedProcedure'] =
  base.protectedProcedure;

/** Like protectedProcedure, additionally exposing ctx.coreTable. */
export const courseProcedure = protectedProcedure.concat(
  createCoreTablePlugin(),
);

/** Like publicProcedure, additionally exposing ctx.coreTable, for procedures anonymous callers may use (e.g. public course discovery). */
export const publicCourseProcedure = publicProcedure.concat(
  createCoreTablePlugin(),
);

/**
 * Like publicProcedure, additionally exposing ctx.search and ctx.coreTable:
 * search is usable signed out, since it only finds published courses, the
 * same as course.publicList, and its responses name categories, which live in
 * the core table (documents hold only the categoryId).
 */
export const publicSearchProcedure = publicProcedure
  .concat(createSearchPlugin())
  .concat(createCoreTablePlugin());

/**
 * Like protectedProcedure, additionally exposing ctx.search and ctx.coreTable,
 * for searches only a signed-in learner may run over a course they are
 * enrolled in: the procedure reads the course's curriculum to scope the query
 * and to name what it finds, which publicSearchProcedure's callers never see.
 */
export const courseSearchProcedure = protectedProcedure
  .concat(createSearchPlugin())
  .concat(createCoreTablePlugin());
