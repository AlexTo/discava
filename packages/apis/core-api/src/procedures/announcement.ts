/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { AnnouncementInputError, announcementPage } from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import {
  ListAnnouncementsInputSchema,
  ListAnnouncementsOutputSchema,
} from '../schema/index.js';
import { getEnrolment, requireEnrolment } from './enrolment.js';

const DEFAULT_AUTHOR_NAME = 'Instructor';

// A course's announcements, newest first, for the students enrolled in it
// (archived courses included, like the rest of their content). The caller is
// always the signed-in user.
export const listAnnouncements = courseProcedure
  .input(ListAnnouncementsInputSchema)
  .output(ListAnnouncementsOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, cursor, limit } = input;

    const [{ data: course }, enrolment] = await Promise.all([
      coreTable.entities.course.get({ courseId }).go(),
      getEnrolment(coreTable, courseId, ctx.user.sub),
    ]);
    if (!course) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireEnrolment(course, enrolment);

    let page: Awaited<ReturnType<typeof announcementPage>>;
    try {
      page = await announcementPage(coreTable, { courseId, cursor, limit });
    } catch (error) {
      if (error instanceof AnnouncementInputError) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      }
      throw error;
    }

    // One batch get for the page's distinct authors.
    const authorIds = [...new Set(page.items.map((item) => item.authorId))];
    const names = new Map<string, string>();
    if (authorIds.length > 0) {
      const { data: users } = await coreTable.entities.user
        .get(authorIds.map((userId) => ({ userId })))
        .go();
      for (const user of users) {
        const name = `${user.givenName ?? ''} ${user.familyName ?? ''}`.trim();
        names.set(user.userId, name || DEFAULT_AUTHOR_NAME);
      }
    }

    return {
      items: page.items.map((item) => ({
        announcementId: item.announcementId,
        courseId: item.courseId,
        title: item.title,
        body: item.body,
        authorName: names.get(item.authorId) ?? DEFAULT_AUTHOR_NAME,
        createdAt: item.createdAt,
        ...(item.editedAt !== undefined && { editedAt: item.editedAt }),
      })),
      ...(page.cursor !== undefined && { cursor: page.cursor }),
    };
  });
