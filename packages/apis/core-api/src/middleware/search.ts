/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SearchScope, SearchType } from '@discava/search';
import { initTRPC } from '@trpc/server';
import type { IAuthContext } from './auth.js';
import type { ICoreTableContext } from './core-table.js';

export interface ISearchContext {
  // The courses whose content the caller may see, or undefined when the
  // caller may see every published course's content (an instructor or admin).
  searchScope?: SearchScope;
  // The content types the caller may search at all: a student may not search
  // users, so `user` is dropped from their types (the index can't decide this).
  searchableTypes?: readonly SearchType[];
}

const STUDENT_TYPES = ['course', 'module', 'lesson', 'contentItem'] as const;
const ALL_TYPES = [...STUDENT_TYPES, 'user'] as const;

// The caller's role, from the Cognito groups the auth middleware parses.
const isStaff = (groups: string[]) =>
  groups.includes('instructor') || groups.includes('admin');

// Builds the search scope and the allowed types from the caller's identity:
// a student is scoped to the courses they're enrolled in (dropped enrolments
// and the recalculation's own 'completed' ones count as enrolled) and may not
// search users; an instructor or admin is unscoped and may search everything.
// Exposed for the unit test.
export const resolveSearchContext = async ({
  user,
  coreTable,
}: {
  user: NonNullable<IAuthContext['user']>;
  coreTable: NonNullable<ICoreTableContext['coreTable']>;
}): Promise<ISearchContext> => {
  if (isStaff(user.groups)) {
    return { searchScope: {}, searchableTypes: ALL_TYPES };
  }
  const { data: enrolments } = await coreTable.entities.enrolment.query
    .byUser({ userId: user.sub })
    .go({ pages: 'all' });
  const courseIds = enrolments
    .filter((enrolment) => enrolment.status !== 'dropped')
    .map((enrolment) => enrolment.courseId);
  return { searchScope: { courseIds }, searchableTypes: STUDENT_TYPES };
};

export const createSearchPlugin = () => {
  const t = initTRPC
    .context<ISearchContext & IAuthContext & ICoreTableContext>()
    .create();

  return t.procedure.use(async (opts) => {
    const { user, coreTable } = opts.ctx;
    // searchProcedure is built on protectedProcedure, so both are present.
    if (!user || !coreTable) {
      throw new Error('search requires an authenticated caller and the table');
    }
    return opts.next({
      ctx: {
        ...opts.ctx,
        ...(await resolveSearchContext({ user, coreTable })),
      },
    });
  });
};
