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
import type { z } from 'zod';
import { requireCourseInstructor } from './helpers/course-access.js';

export type Context = IMiddlewareContext;

const base = createApiBase({
  serviceName: 'InstructorApi',
  requiredGroup: 'instructor',
});

export const t: ApiBase['t'] = base.t;
export const publicProcedure: ApiBase['publicProcedure'] = base.publicProcedure;
export const protectedProcedure: ApiBase['protectedProcedure'] =
  base.protectedProcedure;

/** Like protectedProcedure, additionally exposing ctx.coreTable. */
export const courseProcedure = protectedProcedure.concat(
  createCoreTablePlugin(),
);

/**
 * A courseProcedure for a course's instructors: validates the input, then
 * refuses unless the caller teaches `input.courseId`. For a procedure whose
 * course id comes from somewhere else, use courseProcedure and call
 * requireCourseInstructor directly.
 */
export const courseInstructorProcedure = <
  Schema extends z.ZodType<{ courseId: string }>,
>(
  schema: Schema,
) =>
  courseProcedure.input(schema).use(async ({ ctx, input, next }) => {
    await requireCourseInstructor(
      ctx.coreTable,
      (input as { courseId: string }).courseId,
      ctx.user.sub,
    );
    return next();
  });
