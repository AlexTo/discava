/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Logger } from '@aws-lambda-powertools/logger';
import { TRPCError } from '@trpc/server';
import { v7 as uuidv7 } from 'uuid';
import { courseProcedure } from '../init.js';
import {
  activeCourseCheck,
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
  requireCourseInstructor,
  requireCourseNotArchived,
  requireNotArchived,
  transactionConflict,
  writeInActiveCourse,
} from '../lib/course-lifecycle.js';
import { bestEffortCancelTranscodeJobs } from '../lib/mediaconvert-client.js';
import {
  bestEffortDeleteContentItemVideos,
  bestEffortRetirePreviousVersions,
} from '../lib/s3-client.js';
import type { ICoreTableContext } from '../middleware/core-table.js';
import {
  CreateModuleInputSchema,
  CreateModuleOutputSchema,
  DeleteModuleInputSchema,
  DeleteModuleOutputSchema,
  DeleteModulePermanentlyInputSchema,
  DeleteModulePermanentlyOutputSchema,
  HideModuleInputSchema,
  HideModuleOutputSchema,
  PublishModuleInputSchema,
  PublishModuleOutputSchema,
  ReorderModulesInputSchema,
  ReorderModulesOutputSchema,
  RestoreModuleInputSchema,
  RestoreModuleOutputSchema,
  UpdateModuleInputSchema,
  UpdateModuleOutputSchema,
} from '../schema/index.js';

type CoreTable = NonNullable<ICoreTableContext['coreTable']>;

const getModuleOrThrow = async (
  coreTable: CoreTable,
  courseId: string,
  moduleId: string,
) => {
  const { data: module } = await coreTable.entities.module
    .get({ courseId, moduleId })
    .go();
  if (!module) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  return module;
};

// Patches a module only while it's still not archived and its course isn't
// archived either, in one transaction, so an archive landing after the
// caller's own checks can't be written past.
const patchUnarchivedModule = async (
  coreTable: CoreTable,
  courseId: string,
  moduleId: string,
  set: { title?: string; description?: string } & {
    visibility?: 'hidden' | 'visible';
  },
  archivedMessage: string,
) => {
  await writeInActiveCourse(
    coreTable,
    courseId,
    (entities) => [
      entities.module
        .patch({ courseId, moduleId })
        .set(set)
        .where((attr, op) => op.notExists(attr.archivedAt))
        .commit(),
    ],
    async () => {
      const module = await getModuleOrThrow(coreTable, courseId, moduleId);
      requireNotArchived(module, archivedMessage);
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'The module was modified by another request; please retry',
      });
    },
  );
  // Transactions don't return the written attributes.
  return getModuleOrThrow(coreTable, courseId, moduleId);
};

// Content items share the same sk prefix as their parent lesson (moduleId,
// then lessonId, then contentItemId), so querying by just courseId+moduleId
// returns every content item across every lesson in the module in one call.
// Every page is read (a query returns at most 1 MB per page), since callers
// act on the whole set: a missed page would be left unpublished, or escape
// the student-activity check and be orphaned by a permanent delete.
const queryModuleDescendants = async (
  coreTable: CoreTable,
  courseId: string,
  moduleId: string,
) => {
  const { data: lessons } = await coreTable.entities.lesson.query
    .primary({ courseId, moduleId })
    .go({ pages: 'all' });
  const { data: contentItems } = await coreTable.entities.contentItem.query
    .primary({ courseId, moduleId })
    .go({ pages: 'all' });
  return { lessons, contentItems };
};

// Lessons -- and their content items -- have no lifecycle independent of
// their module, and there's no way to reach one once its module is gone, so
// deleting a module cascades to every lesson and content item under it.
// Everything is deleted transactionally so a failure partway through can't
// leave an orphaned lesson or content item referencing a module that no
// longer exists.
//
// `checkedArchivedAt`, when given, is the archivedAt the caller checked: the
// module delete is then conditioned on it being unchanged, so a restore (or a
// restore and re-archive) landing after that check cancels the delete.
const hardDeleteModule = async (
  coreTable: CoreTable,
  logger: Logger | undefined,
  courseId: string,
  moduleId: string,
  { lessons, contentItems }: Awaited<ReturnType<typeof queryModuleDescendants>>,
  checkedArchivedAt?: string,
  // Set for a delete in a draft course: the delete lands only while the course
  // is still a draft.
  draftCourseId?: string,
) => {
  // Nothing currently limits how many lessons/content items a module can
  // hold, so a module this large can't be deleted in one transactional
  // cascade.
  if (
    1 +
      lessons.length +
      contentItems.length +
      (draftCourseId === undefined ? 0 : 1) >
    MAX_TRANSACTION_ITEMS
  ) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        'This module has too many lessons and content items to delete in one operation (the limit is 100 records). Delete some of its lessons first, then the module.',
    });
  }

  // Each content item delete is conditioned on two things -- see the
  // equivalent comment in lesson.ts's hardDeleteLesson for why:
  // - updatedAt (bumped by every write -- see the contentItem entity's
  //   `watch: '*'`) still matching the queried snapshot, so a transcode
  //   completing in between isn't cleaned up from stale data;
  // - studentActivityCount = 0, checked directly rather than through
  //   updatedAt: a millisecond-precision timestamp can come out the same
  //   for a write in the same millisecond (or from another machine's
  //   clock), and student data must never be deleted.
  const { canceled, data: transactionResults } = await coreTable.transaction
    .write((entities) => [
      checkedArchivedAt === undefined
        ? entities.module.delete({ courseId, moduleId }).commit()
        : entities.module
            .delete({ courseId, moduleId })
            .where((attr, op) => op.eq(attr.archivedAt, checkedArchivedAt))
            .commit(),
      ...lessons.map(({ lessonId }) =>
        entities.lesson.delete({ courseId, moduleId, lessonId }).commit(),
      ),
      ...contentItems.map((item) =>
        entities.contentItem
          .delete({
            courseId,
            moduleId,
            lessonId: item.lessonId,
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
    // The module is the transaction's first item.
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
          'The module was restored or changed while it was being deleted; nothing was deleted',
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
        ? 'A content item in this module changed while it was being deleted; retry the delete'
        : 'Failed to delete module',
    });
  }

  // Best-effort: the DynamoDB records are the source of truth for the
  // module's content, so a failure to remove the underlying S3 objects is
  // logged rather than thrown. Video and file items have S3 objects to
  // clean up (and a video possibly a still-running transcode job); a file's
  // sits in a version folder the same cleanup retires (#102).
  const videoContentItems = contentItems.filter(
    (item) => item.type === 'video',
  );
  await bestEffortCancelTranscodeJobs(logger, videoContentItems);
  await bestEffortDeleteContentItemVideos(
    logger,
    contentItems.filter(
      (item) => item.type === 'video' || item.type === 'file',
    ),
  );
  await bestEffortRetirePreviousVersions(logger, videoContentItems);
};

export const createModule = courseProcedure
  .input(CreateModuleInputSchema)
  .output(CreateModuleOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, title, description } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    const course = await getCourseOrThrow(coreTable, courseId);
    requireCourseNotArchived(course);

    // New modules append to the end of the course. `order` isn't part of any
    // key (module counts per course are small enough to sort client-side),
    // so this is a plain query-and-increment rather than an atomic counter.
    const { data: modules } = await coreTable.entities.module.query
      .primary({ courseId })
      .go();
    const order =
      modules.reduce((max, module) => Math.max(max, module.order), 0) + 1;

    // Created behind a check that the course still isn't archived.
    const moduleId = uuidv7();
    await writeInActiveCourse(coreTable, courseId, (entities) => [
      entities.module
        .create({
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
    return getModuleOrThrow(coreTable, courseId, moduleId);
  });

export const updateModule = courseProcedure
  .input(UpdateModuleInputSchema)
  .output(UpdateModuleOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, title, description } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    await requireActiveCourse(coreTable, courseId);
    const existing = await getModuleOrThrow(coreTable, courseId, moduleId);
    requireNotArchived(existing, 'Restore the module before editing it');

    return patchUnarchivedModule(
      coreTable,
      courseId,
      moduleId,
      {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
      },
      'Restore the module before editing it',
    );
  });

// In a draft course this is a permanent, cascading delete. In any other
// course it archives the module instead, keeping it and everything under it
// (and every student's data for it) restorable; see deleteModulePermanently
// for removing an archived module for good.
export const deleteModule = courseProcedure
  .input(DeleteModuleInputSchema)
  .output(DeleteModuleOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    const existing = await getModuleOrThrow(coreTable, courseId, moduleId);
    const course = await getCourseOrThrow(coreTable, courseId);

    if (isDraftCourse(course)) {
      await hardDeleteModule(
        coreTable,
        ctx.logger,
        courseId,
        moduleId,
        await queryModuleDescendants(coreTable, courseId, moduleId),
        undefined,
        courseId,
      );
      // DynamoDB transactions don't return the deleted attributes, but we
      // already fetched the module's pre-delete state above for the
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

    // Only the module itself is marked archived. Its lessons and content
    // items are hidden from students because their ancestor is archived,
    // which keeps this a single write regardless of the module's size and
    // lets a restore bring back exactly what was there.
    await writeInActiveCourse(coreTable, courseId, (entities) => [
      entities.module
        .patch({ courseId, moduleId })
        .set({ archivedAt: new Date().toISOString() })
        .commit(),
    ]);

    // Transactions don't return the written attributes.
    return getModuleOrThrow(coreTable, courseId, moduleId);
  });

// Publishes the module along with every hidden lesson and content item under
// it in one transaction, so students see a newly built module complete
// rather than piece by piece. That includes descendants that were hidden on
// purpose, which have to be hidden again afterwards if they should stay
// hidden. Archived descendants, and content items under an archived lesson,
// are left as they are.
export const publishModule = courseProcedure
  .input(PublishModuleInputSchema)
  .output(PublishModuleOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    await requireActiveCourse(coreTable, courseId);
    const existing = await getModuleOrThrow(coreTable, courseId, moduleId);
    requireNotArchived(existing, 'Restore the module before publishing it');

    const { lessons, contentItems } = await queryModuleDescendants(
      coreTable,
      courseId,
      moduleId,
    );
    const archivedLessonIds = new Set(
      lessons
        .filter((lesson) => lesson.archivedAt)
        .map(({ lessonId }) => lessonId),
    );
    // Only content that has never been published: a lesson or item hidden on
    // purpose after it was visible stays hidden.
    const lessonsToPublish = lessons.filter(
      (lesson) =>
        lesson.visibility === 'hidden' &&
        !lesson.publishedAt &&
        !lesson.archivedAt,
    );
    const contentItemsToPublish = contentItems.filter(
      (item) =>
        item.visibility === 'hidden' &&
        !item.publishedAt &&
        !item.archivedAt &&
        !archivedLessonIds.has(item.lessonId),
    );
    const publishModuleItself = existing.visibility === 'hidden';
    // Lessons that aren't being published themselves but have items that
    // are: each gets a check that it's still not archived, so an item can't
    // be published under a lesson archived in the meantime.
    const publishedLessonIds = new Set(
      lessonsToPublish.map(({ lessonId }) => lessonId),
    );
    const lessonIdsToCheck = [
      ...new Set(contentItemsToPublish.map(({ lessonId }) => lessonId)),
    ].filter((lessonId) => !publishedLessonIds.has(lessonId));

    if (
      !publishModuleItself &&
      lessonsToPublish.length === 0 &&
      contentItemsToPublish.length === 0
    ) {
      return existing;
    }
    // The transaction always carries a write or check on the module itself and
    // one on the course, plus the lesson checks above.
    if (
      2 +
        lessonsToPublish.length +
        lessonIdsToCheck.length +
        contentItemsToPublish.length >
      MAX_TRANSACTION_ITEMS
    ) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message:
          'This module has too many hidden lessons and content items to publish in one operation (the limit is 100 records). Publish some of its lessons first, then the module.',
      });
    }

    const publishedAt = new Date().toISOString();
    // The module goes first, conditioned on still not being archived, so an
    // archive landing after the check above can't be published past. Every
    // lesson and item is likewise conditioned on still not being archived
    // (and every item's lesson too), so one archived after the query above is
    // never published: the whole publish is refused instead, and a retry
    // re-queries and skips it.
    const { canceled, data: transactionResults } = await coreTable.transaction
      .write((entities) => [
        publishModuleItself
          ? entities.module
              .patch({ courseId, moduleId })
              .set({ visibility: 'visible', ...firstPublishedAt(existing) })
              .where((attr, op) => op.notExists(attr.archivedAt))
              .commit()
          : entities.module
              .check({ courseId, moduleId })
              .where((attr, op) => op.notExists(attr.archivedAt))
              .commit(),
        ...lessonsToPublish.map(({ lessonId }) =>
          entities.lesson
            .patch({ courseId, moduleId, lessonId })
            .set({ visibility: 'visible', publishedAt })
            .where((attr, op) => op.notExists(attr.archivedAt))
            .commit(),
        ),
        ...lessonIdsToCheck.map((lessonId) =>
          entities.lesson
            .check({ courseId, moduleId, lessonId })
            .where((attr, op) => op.notExists(attr.archivedAt))
            .commit(),
        ),
        ...contentItemsToPublish.map(({ lessonId, contentItemId }) =>
          entities.contentItem
            .patch({ courseId, moduleId, lessonId, contentItemId })
            .set({ visibility: 'visible', publishedAt })
            .where((attr, op) => op.notExists(attr.archivedAt))
            .commit(),
        ),
        // Last, so every index above still names what it checks: the course
        // must still not be archived (it is read-only once it is).
        activeCourseCheck(entities, courseId),
      ])
      .go();
    if (canceled) {
      if (transactionResults?.at(-1)?.code === 'ConditionalCheckFailed') {
        await requireActiveCourse(coreTable, courseId);
      }
      if (transactionResults?.[0]?.code === 'ConditionalCheckFailed') {
        const module = await getModuleOrThrow(coreTable, courseId, moduleId);
        requireNotArchived(module, 'Restore the module before publishing it');
      }
      // Otherwise a lesson or content item was archived (or deleted -- patch
      // requires the record to exist) between the query and the transaction.
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'The module changed while it was being published; retry',
      });
    }

    // Transactions don't return the written attributes.
    return getModuleOrThrow(coreTable, courseId, moduleId);
  });

// Hides only the module itself; its lessons and content items keep their own
// visibility. Students stop seeing all of them, since a record is only shown
// under visible ancestors. Publishing the module again also publishes every
// hidden lesson and item under it (see publishModule), so one meant to stay
// hidden has to be hidden again afterwards.
export const hideModule = courseProcedure
  .input(HideModuleInputSchema)
  .output(HideModuleOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    await requireActiveCourse(coreTable, courseId);
    const existing = await getModuleOrThrow(coreTable, courseId, moduleId);
    requireNotArchived(existing, 'Restore the module before hiding it');
    if (existing.visibility === 'hidden') {
      return existing;
    }

    return patchUnarchivedModule(
      coreTable,
      courseId,
      moduleId,
      { visibility: 'hidden' },
      'Restore the module before hiding it',
    );
  });

export const restoreModule = courseProcedure
  .input(RestoreModuleInputSchema)
  .output(RestoreModuleOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    const existing = await getModuleOrThrow(coreTable, courseId, moduleId);
    if (!existing.archivedAt) {
      return existing;
    }
    // An archived course is read-only: restore the course first.
    await requireActiveCourse(coreTable, courseId);

    // A restored module goes to the end of the course; the instructor drags
    // it where they want. Every page: all siblings count.
    const { data: modules } = await coreTable.entities.module.query
      .primary({ courseId })
      .go({ pages: 'all' });
    await writeInActiveCourse(coreTable, courseId, (entities) => [
      entities.module
        .patch({ courseId, moduleId })
        .set({ order: nextOrder(modules) })
        .remove(['archivedAt'])
        .commit(),
    ]);

    // Transactions don't return the written attributes.
    return getModuleOrThrow(coreTable, courseId, moduleId);
  });

// Removes an archived module and everything under it for good. Refused while
// any content item in it has student activity: that data must survive
// curriculum edits, so such a module can stay archived but never be deleted.
export const deleteModulePermanently = courseProcedure
  .input(DeleteModulePermanentlyInputSchema)
  .output(DeleteModulePermanentlyOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    const existing = await getModuleOrThrow(coreTable, courseId, moduleId);
    if (!existing.archivedAt) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Archive the module before deleting it permanently',
      });
    }

    const descendants = await queryModuleDescendants(
      coreTable,
      courseId,
      moduleId,
    );
    if (
      descendants.contentItems.some((item) => item.studentActivityCount > 0)
    ) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message:
          'Students have activity in this module, so it can stay archived but cannot be deleted permanently',
      });
    }

    // hardDeleteModule conditions each content item delete on the updatedAt
    // in this same snapshot, so a student's first activity landing after the
    // check above (which bumps updatedAt) cancels the delete rather than
    // destroying that data; and the module delete on the archivedAt checked
    // above, so a restore in between does too.
    await hardDeleteModule(
      coreTable,
      ctx.logger,
      courseId,
      moduleId,
      descendants,
      existing.archivedAt,
    );

    return existing;
  });

const courseModulesChanged = () =>
  new TRPCError({
    code: 'CONFLICT',
    message:
      "The course's modules changed while you were reordering them; reload and try again",
  });

// Puts the course's modules in the given order, writing every `order` in one
// transaction behind the check on the course, so it follows the same archive
// rules as any other edit: nothing is reordered in an archived course. Archived
// modules keep the `order` they had and aren't part of the list.
//
// The list has to be exactly the course's modules that aren't archived, so a
// client that missed a module added, archived or removed in the meantime gets
// `CONFLICT` and reloads rather than overwriting what it never saw. Repeating
// an order the course already has writes nothing.
export const reorderModules = courseProcedure
  .input(ReorderModulesInputSchema)
  .output(ReorderModulesOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleIds } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    await requireActiveCourse(coreTable, courseId);

    if (new Set(moduleIds).size !== moduleIds.length) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'A module can only appear once in the new order',
      });
    }

    // Every page, so no module is missed.
    const readModules = async () => {
      const { data } = await coreTable.entities.module.query
        .primary({ courseId })
        .go({ pages: 'all' });
      return data.filter((module) => !module.archivedAt);
    };
    const modules = await readModules();
    const byId = new Map(modules.map((module) => [module.moduleId, module]));
    if (
      byId.size !== moduleIds.length ||
      moduleIds.some((id) => !byId.has(id))
    ) {
      throw courseModulesChanged();
    }

    // The transaction also carries the check on the course.
    if (1 + moduleIds.length > MAX_TRANSACTION_ITEMS) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `This course has too many modules to reorder in one operation (the limit is ${MAX_TRANSACTION_ITEMS - 1}).`,
      });
    }

    const unchanged = moduleIds.every(
      (id, index) => byId.get(id)?.order === index + 1,
    );
    if (!unchanged) {
      // Each module is conditioned on still not being archived, so one
      // archived after the read above is never moved: the whole reorder is
      // refused.
      await writeInActiveCourse(
        coreTable,
        courseId,
        (entities) =>
          moduleIds.map((moduleId, index) =>
            entities.module
              .patch({ courseId, moduleId })
              .set({ order: index + 1 })
              .where((attr, op) => op.notExists(attr.archivedAt))
              .commit(),
          ),
        () => {
          throw courseModulesChanged();
        },
      );
    }

    // Transactions don't return the written attributes.
    return (await readModules()).sort((a, b) => a.order - b.order);
  });
