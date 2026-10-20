/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Logger } from '@aws-lambda-powertools/logger';
import { TRPCError } from '@trpc/server';
import { v7 as uuidv7 } from 'uuid';
import { courseProcedure } from '../init.js';
import {
  courseNoLongerDraft,
  draftCourseCheck,
  firstPublishedAt,
  getCourseOrThrow,
  hasTransactionConflict,
  initialVisibilityFields,
  isDraftCourse,
  MAX_TRANSACTION_ITEMS,
  nextOrder,
  requireActiveCourse,
  requireAncestorsNotArchived,
  requireCourseInstructor,
  requireCourseNotArchived,
  requireNotArchived,
  transactionConflict,
  writeInActiveCourse,
  writeUnderActiveAncestors,
} from '../lib/course-lifecycle.js';
import { bestEffortCancelTranscodeJobs } from '../lib/mediaconvert-client.js';
import { bestEffortDeleteContentItemVideos } from '../lib/s3-client.js';
import type { ICoreTableContext } from '../middleware/core-table.js';
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

type CoreTable = NonNullable<ICoreTableContext['coreTable']>;

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

// Every page is read (a query returns at most 1 MB per page), since callers
// act on the whole set: a missed page would be left unpublished, or escape
// the student-activity check and be orphaned by a permanent delete.
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
// to every content item under it. The lesson and its content items are
// deleted transactionally so a failure partway through can't leave an
// orphaned content item referencing a lesson that no longer exists.
//
// `checkedArchivedAt`, when given, is the archivedAt the caller checked: the
// lesson delete is then conditioned on it being unchanged, so a restore (or a
// restore and re-archive) landing after that check cancels the delete.
const hardDeleteLesson = async (
  coreTable: CoreTable,
  logger: Logger | undefined,
  { courseId, moduleId, lessonId }: LessonKey,
  contentItems: Awaited<ReturnType<typeof queryLessonContentItems>>,
  checkedArchivedAt?: string,
  // Set for a delete in a draft course: the delete lands only while the course
  // is still a draft.
  draftCourseId?: string,
) => {
  // Nothing currently limits how many content items a lesson can hold, so a
  // lesson this large can't be deleted in one transactional cascade.
  if (
    contentItems.length + 1 + (draftCourseId === undefined ? 0 : 1) >
    MAX_TRANSACTION_ITEMS
  ) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        'This lesson has too many content items to delete in one operation (the limit is 100 records). Delete some of its content items first, then the lesson.',
    });
  }

  // Each content item delete is conditioned on two things:
  // - updatedAt (bumped by every write -- see the contentItem entity's
  //   `watch: '*'`) still matching `contentItems`. Without this, a content
  //   item that changes between the query and this transaction -- most
  //   notably a transcode completing and publishing its HLS output -- would
  //   still be deleted, but the cleanup below would act on the stale
  //   snapshot instead of what was actually removed. A transaction returns
  //   no deleted attributes to clean up from instead, so this can only
  //   reject and ask the caller to retry.
  // - studentActivityCount = 0, checked directly rather than relying on
  //   updatedAt to change: a millisecond-precision timestamp can come out
  //   the same for a write in the same millisecond (or from another
  //   machine's clock), and student data must never be deleted.
  const { canceled, data: transactionResults } = await coreTable.transaction
    .write((entities) => [
      checkedArchivedAt === undefined
        ? entities.lesson.delete({ courseId, moduleId, lessonId }).commit()
        : entities.lesson
            .delete({ courseId, moduleId, lessonId })
            .where((attr, op) => op.eq(attr.archivedAt, checkedArchivedAt))
            .commit(),
      ...contentItems.map((item) =>
        entities.contentItem
          .delete({
            courseId,
            moduleId,
            lessonId,
            contentItemId: item.contentItemId,
          })
          .where(
            (attr, op) =>
              `${op.eq(attr.updatedAt, item.updatedAt)} AND ${op.eq(attr.studentActivityCount, 0)}`,
          )
          .commit(),
      ),
      ...(draftCourseId === undefined
        ? []
        : [draftCourseCheck(entities, draftCourseId)]),
    ])
    .go();

  if (canceled) {
    // The lesson is the transaction's first item.
    const results = transactionResults ?? [];
    // The draft check, when there is one, is its last.
    if (
      draftCourseId !== undefined &&
      results.at(-1)?.code === 'ConditionalCheckFailed'
    ) {
      throw courseNoLongerDraft();
    }
    if (results[0]?.code === 'ConditionalCheckFailed') {
      throw new TRPCError({
        code: 'CONFLICT',
        message:
          'The lesson was restored or changed while it was being deleted; nothing was deleted',
      });
    }
    const staleContentItem = results
      .slice(1)
      .some((result) => result?.code === 'ConditionalCheckFailed');
    // Another transaction touching the same records at that moment.
    if (!staleContentItem && hasTransactionConflict(results)) {
      throw transactionConflict();
    }
    throw new TRPCError({
      code: staleContentItem ? 'CONFLICT' : 'INTERNAL_SERVER_ERROR',
      message: staleContentItem
        ? 'A content item in this lesson changed while it was being deleted; retry the delete'
        : 'Failed to delete lesson',
    });
  }

  // Best-effort: the DynamoDB records are the source of truth for the
  // lesson's content, so a failure to remove the underlying S3 objects is
  // logged rather than thrown. Only video content items have an S3 object
  // to clean up (and possibly a still-running transcode job).
  const videoContentItems = contentItems.filter(
    (item) => item.type === 'video',
  );
  await bestEffortCancelTranscodeJobs(logger, videoContentItems);
  await bestEffortDeleteContentItemVideos(logger, videoContentItems);
};

export const createLesson = courseProcedure
  .input(CreateLessonInputSchema)
  .output(CreateLessonOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, title, description } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);

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

    // New lessons append to the end of their module. `order` isn't part of
    // any key (lesson counts per module are small enough to sort
    // client-side), so this is a plain query-and-increment rather than an
    // atomic counter.
    const { data: lessons } = await coreTable.entities.lesson.query
      .primary({ courseId, moduleId })
      .go();
    const order =
      lessons.reduce((max, lesson) => Math.max(max, lesson.order), 0) + 1;

    // Created in the same transaction as a check that the module is still
    // there and not archived, so a module archived or deleted after the
    // check above can't end up with a new lesson.
    const lessonId = uuidv7();
    await writeUnderActiveAncestors(
      coreTable,
      { courseId, moduleId },
      (entities) => [
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
      ],
    );

    // Transactions don't return the written attributes.
    return getLessonOrThrow(coreTable, { courseId, moduleId, lessonId });
  });

export const updateLesson = courseProcedure
  .input(UpdateLessonInputSchema)
  .output(UpdateLessonOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, lessonId, title, description } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
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
export const deleteLesson = courseProcedure
  .input(DeleteLessonInputSchema)
  .output(DeleteLessonOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, lessonId } = input;
    const key = { courseId, moduleId, lessonId };

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    const existing = await getLessonOrThrow(coreTable, key);
    const course = await getCourseOrThrow(coreTable, courseId);

    if (isDraftCourse(course)) {
      await hardDeleteLesson(
        coreTable,
        ctx.logger,
        key,
        await queryLessonContentItems(coreTable, key),
        undefined,
        courseId,
      );
      // DynamoDB transactions don't return the deleted attributes, but we
      // already fetched the lesson's pre-delete state above for the
      // existence check.
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
export const publishLesson = courseProcedure
  .input(PublishLessonInputSchema)
  .output(PublishLessonOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, lessonId } = input;
    const key = { courseId, moduleId, lessonId };

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
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
export const hideLesson = courseProcedure
  .input(HideLessonInputSchema)
  .output(HideLessonOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, lessonId } = input;
    const key = { courseId, moduleId, lessonId };

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
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
export const restoreLesson = courseProcedure
  .input(RestoreLessonInputSchema)
  .output(RestoreLessonOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, lessonId } = input;
    const key = { courseId, moduleId, lessonId };

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
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

    // A restored lesson goes to the end of its module; the instructor drags it
    // where they want. Every page: all siblings count.
    const { data: lessons } = await coreTable.entities.lesson.query
      .primary({ courseId, moduleId })
      .go({ pages: 'all' });
    // Conditioned on the module still being active, so a module archived
    // after the check above doesn't end up with an active lesson under it.
    await writeUnderActiveAncestors(
      coreTable,
      { courseId, moduleId },
      (entities) => [
        entities.lesson
          .patch(key)
          .set({ order: nextOrder(lessons) })
          .remove(['archivedAt'])
          .commit(),
      ],
    );

    // Transactions don't return the written attributes.
    return getLessonOrThrow(coreTable, key);
  });

// Removes an archived lesson and its content items for good. Refused while
// any content item in it has student activity: that data must survive
// curriculum edits, so such a lesson can stay archived but never be deleted.
export const deleteLessonPermanently = courseProcedure
  .input(DeleteLessonPermanentlyInputSchema)
  .output(DeleteLessonPermanentlyOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, lessonId } = input;
    const key = { courseId, moduleId, lessonId };

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
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

    // hardDeleteLesson conditions each content item delete on the updatedAt
    // in this same snapshot, so a student's first activity landing after the
    // check above (which bumps updatedAt) cancels the delete rather than
    // destroying that data; and the lesson delete on the archivedAt checked
    // above, so a restore in between does too.
    await hardDeleteLesson(
      coreTable,
      ctx.logger,
      key,
      contentItems,
      existing.archivedAt,
    );

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
export const reorderLessons = courseProcedure
  .input(ReorderLessonsInputSchema)
  .output(ReorderLessonsOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, lessonIds } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    await requireAncestorsNotArchived(coreTable, { courseId, moduleId });

    if (new Set(lessonIds).size !== lessonIds.length) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'A lesson can only appear once in the new order',
      });
    }

    // Every page, so no lesson is missed.
    const readLessons = async () => {
      const { data } = await coreTable.entities.lesson.query
        .primary({ courseId, moduleId })
        .go({ pages: 'all' });
      return data.filter((lesson) => !lesson.archivedAt);
    };
    const lessons = await readLessons();
    const byId = new Map(lessons.map((lesson) => [lesson.lessonId, lesson]));
    if (
      byId.size !== lessonIds.length ||
      lessonIds.some((id) => !byId.has(id))
    ) {
      throw moduleLessonsChanged();
    }

    // The transaction also carries the checks on the course and module.
    if (2 + lessonIds.length > MAX_TRANSACTION_ITEMS) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `This module has too many lessons to reorder in one operation (the limit is ${MAX_TRANSACTION_ITEMS - 2}).`,
      });
    }

    const unchanged = lessonIds.every(
      (id, index) => byId.get(id)?.order === index + 1,
    );
    if (!unchanged) {
      // Each lesson is conditioned on still not being archived, so one
      // archived after the read above is never moved: the whole reorder is
      // refused.
      await writeUnderActiveAncestors(
        coreTable,
        { courseId, moduleId },
        (entities) =>
          lessonIds.map((lessonId, index) =>
            entities.lesson
              .patch({ courseId, moduleId, lessonId })
              .set({ order: index + 1 })
              .where((attr, op) => op.notExists(attr.archivedAt))
              .commit(),
          ),
        () => {
          throw moduleLessonsChanged();
        },
      );
    }

    // Transactions don't return the written attributes.
    return (await readLessons()).sort((a, b) => a.order - b.order);
  });
