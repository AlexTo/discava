/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { transactionConflict } from '@discava/common-server-utils/trpc-api-base';
import { plainTextExcerpt } from '@discava/common-tiptap';
import {
  AnnouncementInputError,
  announcementDeleteWrites,
  announcementEditWrites,
  announcementPage,
  announcementWrites,
  type CancellationReasons,
  type CoreTable,
  cancellationReasons,
  failedAt,
  hasTransactionConflict,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import {
  getCourseOrThrow,
  requireCourseInstructor,
} from '../helpers/course-lifecycle.js';
import { courseProcedure } from '../init.js';
import {
  CreateAnnouncementInputSchema,
  CreateAnnouncementOutputSchema,
  DeleteAnnouncementInputSchema,
  DeleteAnnouncementOutputSchema,
  type IAnnouncement,
  ListAnnouncementsInputSchema,
  ListAnnouncementsOutputSchema,
  UpdateAnnouncementInputSchema,
  UpdateAnnouncementOutputSchema,
} from '../schema/index.js';

const EXCERPT_CHARS = 200;
const DEFAULT_AUTHOR_NAME = 'Instructor';

type StoredAnnouncement = Omit<IAnnouncement, 'authorName'>;

const withAuthorName = (
  announcement: StoredAnnouncement,
  authorName: string,
): IAnnouncement => ({
  announcementId: announcement.announcementId,
  courseId: announcement.courseId,
  title: announcement.title,
  body: announcement.body,
  authorId: announcement.authorId,
  authorName,
  createdAt: announcement.createdAt,
  ...(announcement.editedAt !== undefined && {
    editedAt: announcement.editedAt,
  }),
  version: announcement.version,
});

// The display name of each author, from one batch get of their users.
const authorNames = async (coreTable: CoreTable, authorIds: string[]) => {
  const distinct = [...new Set(authorIds)];
  const names = new Map<string, string>();
  if (distinct.length === 0) {
    return names;
  }
  const { data: users } = await coreTable.entities.user
    .get(distinct.map((userId) => ({ userId })))
    .go();
  for (const user of users) {
    const name = `${user.givenName ?? ''} ${user.familyName ?? ''}`.trim();
    names.set(user.userId, name || DEFAULT_AUTHOR_NAME);
  }
  return names;
};

const readAnnouncement = async (
  coreTable: CoreTable,
  courseId: string,
  announcementId: string,
) => {
  const { data } = await coreTable.entities.announcement
    .get({ courseId, announcementId })
    .go();
  return data ?? undefined;
};

// Posts an announcement and asks for the course's students to be notified,
// in one transaction (core-table's announcementWrites). The caller's id makes
// it idempotent: a retry after the post committed finds the stored
// announcement and, when it is the same post, answers it as success.
export const createAnnouncement = courseProcedure
  .input(CreateAnnouncementInputSchema)
  .output(CreateAnnouncementOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, announcementId, title, body } = input;
    const authorId = ctx.user.sub;

    await requireCourseInstructor(coreTable, courseId, authorId);
    const course = await getCourseOrThrow(coreTable, courseId);
    if (course.status !== 'published') {
      throw notPublished();
    }

    let items: ReturnType<typeof announcementWrites>;
    try {
      items = announcementWrites(coreTable, {
        courseId,
        courseTitle: course.title,
        announcementId,
        title,
        body,
        excerpt: plainTextExcerpt(body, EXCERPT_CHARS),
        authorId,
        now: new Date(),
      });
    } catch (error) {
      if (error instanceof AnnouncementInputError) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      }
      throw error;
    }

    const { canceled, data: results } = await coreTable.transaction
      .write(() => items)
      .go();

    if (canceled) {
      const failed = failedChecks(results);
      const existing = await readAnnouncement(
        coreTable,
        courseId,
        announcementId,
      );
      if (existing) {
        // A retry of the same post is the same announcement; anything else
        // under this id is another post.
        if (
          existing.authorId === authorId &&
          existing.title === title.trim() &&
          existing.body === body
        ) {
          return withAuthorName(
            existing,
            (await authorNames(coreTable, [authorId])).get(authorId) ??
              DEFAULT_AUTHOR_NAME,
          );
        }
        throw idTaken();
      }
      if (failed[1]) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      if (failed[2]) {
        throw notPublished();
      }
      if (failed[0] || failed[3]) {
        throw idTaken();
      }
      if (hasTransactionConflict(results)) {
        throw transactionConflict();
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to post the announcement',
      });
    }

    // Transactions don't return the written attributes.
    const created = await readAnnouncement(coreTable, courseId, announcementId);
    if (!created) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to read the announcement after posting it',
      });
    }
    return withAuthorName(
      created,
      (await authorNames(coreTable, [authorId])).get(authorId) ??
        DEFAULT_AUTHOR_NAME,
    );
  });

// A course's announcements, newest first, for the instructors teaching it.
// Allowed at any course status, so an archived course's can still be read.
export const listAnnouncements = courseProcedure
  .input(ListAnnouncementsInputSchema)
  .output(ListAnnouncementsOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, cursor, limit } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);

    let page: Awaited<ReturnType<typeof announcementPage>>;
    try {
      page = await announcementPage(coreTable, { courseId, cursor, limit });
    } catch (error) {
      if (error instanceof AnnouncementInputError) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      }
      throw error;
    }

    const names = await authorNames(
      coreTable,
      page.items.map((item) => item.authorId),
    );
    return {
      items: page.items.map((item) =>
        withAuthorName(item, names.get(item.authorId) ?? DEFAULT_AUTHOR_NAME),
      ),
      ...(page.cursor !== undefined && { cursor: page.cursor }),
    };
  });

// Edits the title and/or body of an announcement. The caller's version is a
// condition of the write, so an edit made from a stale read is refused.
// Never notifies: students were told once, when it was posted.
export const updateAnnouncement = courseProcedure
  .input(UpdateAnnouncementInputSchema)
  .output(UpdateAnnouncementOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, announcementId, version, title, body } = input;
    const instructorId = ctx.user.sub;

    await requireCourseInstructor(coreTable, courseId, instructorId);
    const existing = await readAnnouncement(
      coreTable,
      courseId,
      announcementId,
    );
    if (!existing) {
      throw announcementNotFound();
    }

    let items: ReturnType<typeof announcementEditWrites>;
    try {
      items = announcementEditWrites(coreTable, {
        courseId,
        announcementId,
        instructorId,
        version,
        title,
        body,
        now: new Date(),
      });
    } catch (error) {
      if (error instanceof AnnouncementInputError) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      }
      throw error;
    }

    const { canceled, data: results } = await coreTable.transaction
      .write(() => items)
      .go();

    if (canceled) {
      const failed = failedChecks(results);
      if (failed[1]) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      if (failed[0]) {
        // The version no longer matches, or the announcement was deleted.
        const current = await readAnnouncement(
          coreTable,
          courseId,
          announcementId,
        );
        throw current
          ? new TRPCError({
              code: 'CONFLICT',
              message:
                'This announcement changed. Reload to see the latest text.',
            })
          : announcementNotFound();
      }
      if (hasTransactionConflict(results)) {
        throw transactionConflict();
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to edit the announcement',
      });
    }

    const updated = await readAnnouncement(coreTable, courseId, announcementId);
    if (!updated) {
      throw announcementNotFound();
    }
    return withAuthorName(
      updated,
      (await authorNames(coreTable, [updated.authorId])).get(
        updated.authorId,
      ) ?? DEFAULT_AUTHOR_NAME,
    );
  });

// Removes an announcement. Students keep the notification they received.
export const deleteAnnouncement = courseProcedure
  .input(DeleteAnnouncementInputSchema)
  .output(DeleteAnnouncementOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, announcementId } = input;
    const instructorId = ctx.user.sub;

    await requireCourseInstructor(coreTable, courseId, instructorId);
    const existing = await readAnnouncement(
      coreTable,
      courseId,
      announcementId,
    );
    if (!existing) {
      throw announcementNotFound();
    }

    const { canceled, data: results } = await coreTable.transaction
      .write(() =>
        announcementDeleteWrites(coreTable, {
          courseId,
          announcementId,
          instructorId,
        }),
      )
      .go();

    if (canceled) {
      const failed = failedChecks(results);
      if (failed[1]) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      if (failed[0]) {
        throw announcementNotFound();
      }
      if (hasTransactionConflict(results)) {
        throw transactionConflict();
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to delete the announcement',
      });
    }
    return { announcementId };
  });

const failedChecks = (results: CancellationReasons | undefined) => {
  const reasons = cancellationReasons(results);
  return reasons.map((_, index) => failedAt(reasons, index));
};

const announcementNotFound = () =>
  new TRPCError({ code: 'NOT_FOUND', message: 'Announcement not found' });

const notPublished = () =>
  new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: 'Only a published course can have announcements',
  });

const idTaken = () =>
  new TRPCError({
    code: 'CONFLICT',
    message: 'This announcement id is already used by another announcement',
  });
