/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Logger } from '@aws-lambda-powertools/logger';
import { type CoreTable, lessonHasDiscussion } from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { v7 as uuidv7 } from 'uuid';
import {
  MAX_TRANSACTION_ITEMS,
  writeInActiveCourse,
  writeUnderActiveAncestors,
} from '../helpers/ancestor-writes.js';
import { getCourseOrThrow } from '../helpers/course-access.js';
import {
  firstPublishedAt,
  initialVisibilityFields,
  isDraftCourse,
  requireActiveCourse,
  requireAncestorsNotArchived,
  requireCourseNotArchived,
  requireNotArchived,
} from '../helpers/curriculum-guards.js';
import { hardDeleteCurriculumNode } from '../helpers/hard-delete.js';
import { writeAtEnd } from '../helpers/order.js';
import { reorderChildren } from '../helpers/reorder.js';
import { courseInstructorProcedure } from '../init.js';
import {
  CreateLessonInputSchema,
  CreateLessonOutputSchema,
  DeleteLessonInputSchema,
  DeleteLessonOutputSchema,
  DeleteLessonPermanentlyInputSchema,
  DeleteLessonPermanentlyOutputSchema,
  HideLessonInputSchema,
  HideLessonOutputSchema,
  PublishLessonInputSchema,
  PublishLessonOutputSchema,
  ReorderLessonsInputSchema,
  ReorderLessonsOutputSchema,
  RestoreLessonInputSchema,
  RestoreLessonOutputSchema,
  UpdateLessonInputSchema,
  UpdateLessonOutputSchema,
} from '../schema/index.js';

interface LessonKey {
  courseId: string;
  moduleId: string;
  lessonId: string;
}

const getLessonOrThrow = async (coreTable: CoreTable, key: LessonKey) => {
  const { data: lesson } = await coreTable.entities.lesson.get(key).go();
  if (!lesson) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  return lesson;
};

// After a guarded write was refused by the lesson's own condition: reports
// why, from its current state.
const throwForLessonState = async (
  coreTable: CoreTable,
  key: LessonKey,
  archivedMessage: string,
): Promise<never> => {
  const lesson = await getLessonOrThrow(coreTable, key);
  requireNotArchived(lesson, archivedMessage);
  throw new TRPCError({
    code: 'CONFLICT',
    message: 'The lesson was modified by another request; please retry',
  });
};

// Every page is read (a query returns at most 1 MB per page), since callers
// act on the whole set: a missed page would be left unpublished, or escape
// the student-activity check and be orphaned by a permanent delete.
const queryLessonContentItems = async (
  coreTable: CoreTable,
  key: LessonKey,
) => {
  const { data: contentItems } = await coreTable.entities.contentItem.query
    .primary(key)
    .go({ pages: 'all' });
  return contentItems;
};

// Content items have no lifecycle independent of their lesson, and there's
// no way to reach one once its lesson is gone, so deleting a lesson cascades
// to every content item under it.
const hardDeleteLesson = (
  coreTable: CoreTable,
  logger: Logger | undefined,
  { courseId, moduleId, lessonId }: LessonKey,
  contentItems: Awaited<ReturnType<typeof queryLessonContentItems>>,
  options: { checkedArchivedAt?: string; draftCourseId?: string },
) =>
  hardDeleteCurriculumNode(coreTable, logger, {
    courseId,
    moduleId,
    deleteNode: (entities, checkedArchivedAt) =>
      checkedArchivedAt === undefined
        ? entities.lesson.delete({ courseId, moduleId, lessonId }).commit()
        : entities.lesson
            .delete({ courseId, moduleId, lessonId })
            .where((attr, op) => op.eq(attr.archivedAt, checkedArchivedAt))
            .commit(),
    contentItems,
    ...options,
    messages: {
      tooMany:
        'This lesson has too many content items to delete in one operation (the limit is 100 records). Delete some of its content items first, then the lesson.',
      restoredOrChanged:
        'The lesson was restored or changed while it was being deleted; nothing was deleted',
      contentItemChanged:
        'A content item in this lesson changed while it was being deleted; retry the delete',
      failed: 'Failed to delete lesson',
    },
  });

export const createLesson = courseInstructorProcedure(CreateLessonInputSchema)
  .output(CreateLessonOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, moduleId, title, description } = input;

    const course = await getCourseOrThrow(coreTable, courseId);
    requireCourseNotArchived(course);
    const { data: module } = await coreTable.entities.module
      .get({ courseId, moduleId })
      .go();
    if (!module) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireNotArchived(
      module,
      'Restore the module before adding lessons to it',
    );

    // Appended to the module in the same transaction as a check that it's
    // still there and not archived, so a module archived or deleted after the
    // check above can't end up with a new lesson.
    const lessonId = uuidv7();
    await writeAtEnd(coreTable, { courseId, moduleId }, (entities, order) => [
      entities.lesson
        .create({
          lessonId,
          moduleId,
          courseId,
          title,
          description,
          order,
          ...initialVisibilityFields(course),
        })
        .commit(),
    ]);

    // Transactions don't return the written attributes.
    return getLessonOrThrow(coreTable, { courseId, moduleId, lessonId });
  });

export const updateLesson = courseInstructorProcedure(UpdateLessonInputSchema)
  .output(UpdateLessonOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, moduleId, lessonId, title, description } = input;

    const existing = await getLessonOrThrow(coreTable, {
      courseId,
      moduleId,
      lessonId,
    });
    requireNotArchived(existing, 'Restore the lesson before editing it');
    await requireAncestorsNotArchived(coreTable, { courseId, moduleId });

    const key = { courseId, moduleId, lessonId };
    // Conditioned, in one transaction, on the module still being active and
    // the lesson still not archived, so an archive landing after the checks
    // above can't be edited past.
    await writeUnderActiveAncestors(
      coreTable,
      { courseId, moduleId },
      (entities) => [
        entities.lesson
          .patch(key)
          .set({
            ...(title !== undefined && { title }),
            ...(description !== undefined && { description }),
          })
          .where((attr, op) => op.notExists(attr.archivedAt))
          .commit(),
      ],
      () =>
        throwForLessonState(
          coreTable,
          key,
          'Restore the lesson before editing it',
        ),
    );

    // Transactions don't return the written attributes.
    return getLessonOrThrow(coreTable, key);
  });

// In a draft course this is a permanent, cascading delete. In any other
// course it archives the lesson instead, keeping it, its content items, and
// every student's data for them restorable; see deleteLessonPermanently for
// removing an archived lesson for good.
export const deleteLesson = courseInstructorProcedure(DeleteLessonInputSchema)
  .output(DeleteLessonOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, moduleId, lessonId } = input;
    const key = { courseId, moduleId, lessonId };

    const existing = await getLessonOrThrow(coreTable, key);
    const course = await getCourseOrThrow(coreTable, courseId);

    if (isDraftCourse(course)) {
      await hardDeleteLesson(
        coreTable,
        ctx.logger,
        key,
        await queryLessonContentItems(coreTable, key),
        { draftCourseId: courseId },
      );
      // Transactions don't return the deleted attributes.
      return existing;
    }

    // Already archived: archiving again is a no-op, so a retried request
    // doesn't move archivedAt.
    if (existing.archivedAt) {
      return existing;
    }

    // An archived course is read-only, so nothing in it is archived either.
    requireCourseNotArchived(course);

    // Only the lesson itself is marked archived; its content items are hidden
    // from students because their lesson is archived.
    await writeInActiveCourse(coreTable, courseId, (entities) => [
      entities.lesson
        .patch(key)
        .set({ archivedAt: new Date().toISOString() })
        .commit(),
    ]);

    // Transactions don't return the written attributes.
    return getLessonOrThrow(coreTable, key);
  });

// Publishes the lesson along with every hidden content item in it in one
// transaction, so students see a newly built lesson complete -- including
// any item that was hidden on purpose, which has to be hidden again
// afterwards if it should stay hidden. Students still don't see the lesson
// until its module is visible too.
export const publishLesson = courseInstructorProcedure(PublishLessonInputSchema)
  .output(PublishLessonOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, moduleId, lessonId } = input;
    const key = { courseId, moduleId, lessonId };

    const existing = await getLessonOrThrow(coreTable, key);
    requireNotArchived(existing, 'Restore the lesson before publishing it');
    await requireAncestorsNotArchived(coreTable, { courseId, moduleId });

    const contentItemsToPublish = (
      await queryLessonContentItems(coreTable, key)
    ).filter(
      // Only content that has never been published: an item hidden on purpose
      // after it was visible stays hidden.
      (item) =>
        item.visibility === 'hidden' && !item.publishedAt && !item.archivedAt,
    );
    const publishLessonItself = existing.visibility === 'hidden';

    if (!publishLessonItself && contentItemsToPublish.length === 0) {
      return existing;
    }
    // The transaction also carries a check on the course and one on the
    // module, and a write or check on the lesson itself.
    if (3 + contentItemsToPublish.length > MAX_TRANSACTION_ITEMS) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message:
          'This lesson has too many hidden content items to publish in one operation (the limit is 100 records). Publish some of its content items first, then the lesson.',
      });
    }

    const publishedAt = new Date().toISOString();
    // Conditioned on the module still being active and the lesson still not
    // archived, so an archive landing after the checks above can't be
    // published past. Any other cancellation -- a content item archived or
    // deleted between the query and the transaction (patch requires the
    // record to exist) -- is a CONFLICT to retry.
    await writeUnderActiveAncestors(
      coreTable,
      { courseId, moduleId },
      (entities) => [
        publishLessonItself
          ? entities.lesson
              .patch(key)
              .set({ visibility: 'visible', ...firstPublishedAt(existing) })
              .where((attr, op) => op.notExists(attr.archivedAt))
              .commit()
          : entities.lesson
              .check(key)
              .where((attr, op) => op.notExists(attr.archivedAt))
              .commit(),
        // Each item is conditioned on still not being archived, so one
        // archived after the query above is never published: the whole
        // publish is refused instead, and a retry re-queries and skips it.
        ...contentItemsToPublish.map(({ contentItemId }) =>
          entities.contentItem
            .patch({ ...key, contentItemId })
            .set({ visibility: 'visible', publishedAt })
            .where((attr, op) => op.notExists(attr.archivedAt))
            .commit(),
        ),
      ],
      () =>
        throwForLessonState(
          coreTable,
          key,
          'Restore the lesson before publishing it',
        ),
    );

    // Transactions don't return the written attributes.
    return getLessonOrThrow(coreTable, key);
  });

// Hides only the lesson itself; its content items keep their own
// visibility. Students stop seeing all of them, since an item is only shown
// under a visible lesson. Publishing the lesson again also publishes every
// hidden item in it (see publishLesson), so an item meant to stay hidden has
// to be hidden again afterwards.
export const hideLesson = courseInstructorProcedure(HideLessonInputSchema)
  .output(HideLessonOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, moduleId, lessonId } = input;
    const key = { courseId, moduleId, lessonId };

    const existing = await getLessonOrThrow(coreTable, key);
    requireNotArchived(existing, 'Restore the lesson before hiding it');
    await requireAncestorsNotArchived(coreTable, { courseId, moduleId });
    if (existing.visibility === 'hidden') {
      return existing;
    }

    // Conditioned on the module still being active and the lesson still not
    // archived, so an archive landing after the checks above can't be
    // hidden past.
    await writeUnderActiveAncestors(
      coreTable,
      { courseId, moduleId },
      (entities) => [
        entities.lesson
          .patch(key)
          .set({ visibility: 'hidden' })
          .where((attr, op) => op.notExists(attr.archivedAt))
          .commit(),
      ],
      () =>
        throwForLessonState(
          coreTable,
          key,
          'Restore the lesson before hiding it',
        ),
    );

    // Transactions don't return the written attributes.
    return getLessonOrThrow(coreTable, key);
  });

// A lesson under an archived module can't be restored on its own: it would
// still be hidden by its module, so the module has to come back first.
export const restoreLesson = courseInstructorProcedure(RestoreLessonInputSchema)
  .output(RestoreLessonOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, moduleId, lessonId } = input;
    const key = { courseId, moduleId, lessonId };

    const existing = await getLessonOrThrow(coreTable, key);
    if (!existing.archivedAt) {
      return existing;
    }
    // An archived course is read-only: restore the course first.
    await requireActiveCourse(coreTable, courseId);

    const { data: module } = await coreTable.entities.module
      .get({ courseId, moduleId })
      .go();
    if (!module) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireNotArchived(module, 'Restore the module first');

    // A restored lesson goes to the end of its module, conditioned on the
    // module still being active, so a module archived after the check above
    // doesn't end up with an active lesson under it.
    await writeAtEnd(coreTable, { courseId, moduleId }, (entities, order) => [
      entities.lesson.patch(key).set({ order }).remove(['archivedAt']).commit(),
    ]);

    // Transactions don't return the written attributes.
    return getLessonOrThrow(coreTable, key);
  });

// Removes an archived lesson and its content items for good. Refused while
// any content item in it has student activity: that data must survive
// curriculum edits, so such a lesson can stay archived but never be deleted.
export const deleteLessonPermanently = courseInstructorProcedure(
  DeleteLessonPermanentlyInputSchema,
)
  .output(DeleteLessonPermanentlyOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, moduleId, lessonId } = input;
    const key = { courseId, moduleId, lessonId };

    const existing = await getLessonOrThrow(coreTable, key);
    if (!existing.archivedAt) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Archive the lesson before deleting it permanently',
      });
    }

    const contentItems = await queryLessonContentItems(coreTable, key);
    if (contentItems.some((item) => item.studentActivityCount > 0)) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message:
          'Students have activity in this lesson, so it can stay archived but cannot be deleted permanently',
      });
    }

    // Questions are student data too. None can be asked once the lesson is
    // archived, so one read here is enough.
    if (await lessonHasDiscussion(coreTable, key)) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message:
          'This lesson has questions, so it can stay archived but cannot be deleted permanently',
      });
    }

    // hardDeleteLesson conditions each content item delete on the updatedAt
    // in this same snapshot, so a student's first activity landing after the
    // check above (which bumps updatedAt) cancels the delete rather than
    // destroying that data; and the lesson delete on the archivedAt checked
    // above, so a restore in between does too.
    await hardDeleteLesson(coreTable, ctx.logger, key, contentItems, {
      checkedArchivedAt: existing.archivedAt,
    });

    return existing;
  });

const moduleLessonsChanged = () =>
  new TRPCError({
    code: 'CONFLICT',
    message:
      "The module's lessons changed while you were reordering them; reload and try again",
  });

// Puts the module's lessons in the given order, writing every `order` in one
// transaction behind the checks on the course and module, so it follows the
// same archive rules as any other edit: nothing is reordered in an archived
// course or module. Archived lessons keep the `order` they had and aren't part
// of the list. Lessons stay in their module: moving one to another module
// isn't supported.
//
// The list has to be exactly the module's lessons that aren't archived, so a
// client that missed a lesson added, archived or removed in the meantime gets
// `CONFLICT` and reloads rather than overwriting what it never saw. Repeating
// an order the module already has writes nothing.
export const reorderLessons = courseInstructorProcedure(
  ReorderLessonsInputSchema,
)
  .output(ReorderLessonsOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, moduleId, lessonIds } = input;

    await requireAncestorsNotArchived(coreTable, { courseId, moduleId });

    return reorderChildren({
      ids: lessonIds,
      // Every page, so no lesson is missed.
      readActive: async () => {
        const { data } = await coreTable.entities.lesson.query
          .primary({ courseId, moduleId })
          .go({ pages: 'all' });
        return data.filter((lesson) => !lesson.archivedAt);
      },
      idOf: (lesson) => lesson.lessonId,
      // Each lesson is conditioned on still not being archived, so one
      // archived after the read is never moved: the whole reorder is refused.
      patch: (entities, lessonId, order) =>
        entities.lesson
          .patch({ courseId, moduleId, lessonId })
          .set({ order })
          .where((attr, op) => op.notExists(attr.archivedAt))
          .commit(),
      write: (writes, onChanged) =>
        writeUnderActiveAncestors(
          coreTable,
          { courseId, moduleId },
          writes,
          onChanged,
        ),
      // The transaction also carries the checks on the course and module.
      checkCount: 2,
      duplicateMessage: 'A lesson can only appear once in the new order',
      tooManyMessage: (limit) =>
        `This module has too many lessons to reorder in one operation (the limit is ${limit}).`,
      changedError: moduleLessonsChanged,
    });
  });
