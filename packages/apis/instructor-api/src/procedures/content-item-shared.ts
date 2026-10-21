/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Logger } from '@aws-lambda-powertools/logger';
import { isConditionalCheckFailed } from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import {
  courseNoLongerDraft,
  draftCourseCheck,
  firstPublishedAt,
  getCourseOrThrow,
  isDraftCourse,
  MAX_TRANSACTION_ITEMS,
  nextOrder,
  requireActiveCourse,
  requireAncestorsNotArchived,
  requireCourseInstructor,
  requireCourseNotArchived,
  requireNotArchived,
  writeInActiveCourse,
  writeUnderActiveAncestors,
} from '../lib/course-lifecycle.js';
import {
  bestEffortCancelTranscodeJobs,
  type ICancelableVideoContentItem,
} from '../lib/mediaconvert-client.js';
import {
  bestEffortDeleteContentItemVideos,
  bestEffortRetirePreviousVersions,
  type IDeletableVideoContentItem,
} from '../lib/s3-client.js';
import type { ICoreTableContext } from '../middleware/core-table.js';
import {
  DeleteContentItemInputSchema,
  DeleteContentItemOutputSchema,
  DeleteContentItemPermanentlyInputSchema,
  DeleteContentItemPermanentlyOutputSchema,
  HideContentItemInputSchema,
  HideContentItemOutputSchema,
  type IDeleteContentItemOutput,
  type IDeleteContentItemPermanentlyOutput,
  type IHideContentItemOutput,
  type IPublishContentItemOutput,
  type IReorderContentItemsOutput,
  type IRestoreContentItemOutput,
  PublishContentItemInputSchema,
  PublishContentItemOutputSchema,
  ReorderContentItemsInputSchema,
  ReorderContentItemsOutputSchema,
  RestoreContentItemInputSchema,
  RestoreContentItemOutputSchema,
} from '../schema/index.js';

type CoreTable = NonNullable<ICoreTableContext['coreTable']>;

interface ContentItemKey {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
}

// ElectroDB has no native discriminated-attribute support, so a contentItem
// record's inferred type is flat (every type's attributes present as
// optional alongside `type` itself) rather than a proper union keyed on
// `type`. These casts bridge that gap to the discriminated-union API types
// -- safe because each cast site has already checked/branched on `type` (or,
// for the type-agnostic procedures below, is just passing through whatever
// record it read or wrote). Shared across every content-item-<type>.ts
// procedures file.
export const asContentItemOutput = <T>(contentItem: unknown) =>
  contentItem as T;

// Sets the item's visibility (and, when publishing it for the first time,
// its publishedAt) in one transaction with checks that its module and lesson
// are still active, conditioned on the item itself still not being archived,
// so an archive landing after the caller's own checks can't be written past.
const setVisibilityUnderActiveAncestors = async (
  coreTable: CoreTable,
  key: ContentItemKey,
  change: { visibility: 'hidden' | 'visible'; publishedAt?: string },
  archivedMessage: string,
) => {
  await writeUnderActiveAncestors(
    coreTable,
    key,
    (entities) => [
      entities.contentItem
        .patch(key)
        .set(change)
        .where((attr, op) => op.notExists(attr.archivedAt))
        .commit(),
    ],
    async () => {
      requireNotArchived(
        await getContentItemOrThrow(coreTable, key),
        archivedMessage,
      );
      throw new TRPCError({
        code: 'CONFLICT',
        message:
          'The content item was modified by another request; please retry',
      });
    },
  );
  // Transactions don't return the written attributes.
  return getContentItemOrThrow(coreTable, key);
};

const getContentItemOrThrow = async (
  coreTable: CoreTable,
  key: ContentItemKey,
) => {
  const { data: contentItem } = await coreTable.entities.contentItem
    .get(key)
    .go();
  if (!contentItem) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  return contentItem;
};

// Removes the record for good, then its external storage. Uses the record
// DeleteItem actually removed (response: 'all_old'), not an earlier read -- a
// concurrent replacement could have landed between the two, and cleaning up
// based on stale state would cancel/delete the wrong job and orphan the real
// one.
const cleanUpDeletedContentItem = async (
  logger: Logger | undefined,
  contentItem: ICancelableVideoContentItem &
    IDeletableVideoContentItem & { type: string; s3Key?: string },
) => {
  if (contentItem.type === 'video') {
    // A still-transcoding job has nothing left to report to once its
    // content item is gone -- cancel it so it doesn't keep running only to
    // leave an orphaned HLS output with no record pointing at it.
    await bestEffortCancelTranscodeJobs(logger, [contentItem]);
    if (contentItem.s3Key) {
      await bestEffortDeleteContentItemVideos(logger, [contentItem]);
    }
    await bestEffortRetirePreviousVersions(logger, [contentItem]);
  }
};

// Type-agnostic: works the same for every content item type (video, text,
// and whatever else lands here -- quiz, image, etc.), only branching to
// clean up a type's own external storage (e.g. video's S3 object) where
// that type has any.
//
// In a draft course this deletes the item for good. In any other course it
// archives the item instead, keeping it and every student's data for it
// restorable; see deleteContentItemPermanently for removing an archived item
// for good.
export const deleteContentItem = courseProcedure
  .input(DeleteContentItemInputSchema)
  .output(DeleteContentItemOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, lessonId, contentItemId } = input;
    const key = { courseId, moduleId, lessonId, contentItemId };

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    const existing = await getContentItemOrThrow(coreTable, key);
    const course = await getCourseOrThrow(coreTable, courseId);

    if (isDraftCourse(course)) {
      // Deleted in one transaction with a check that the course is still a
      // draft, and conditioned on the item still being as it was read: a
      // transaction returns no deleted attributes, so the cleanup below acts
      // on `existing`, which this guarantees is what was removed.
      const { canceled, data: results } = await coreTable.transaction
        .write((entities) => [
          entities.contentItem
            .delete(key)
            .where((attr, op) => op.eq(attr.updatedAt, existing.updatedAt))
            .commit(),
          draftCourseCheck(entities, courseId),
        ])
        .go();
      if (canceled) {
        if (results?.[1]?.code === 'ConditionalCheckFailed') {
          throw courseNoLongerDraft();
        }
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'The content item changed while it was being deleted; nothing was deleted. Retry the delete',
        });
      }
      await cleanUpDeletedContentItem(ctx.logger, existing);
      return asContentItemOutput<IDeleteContentItemOutput>(existing);
    }

    // Already archived: archiving again is a no-op, so a retried request
    // doesn't move archivedAt.
    if (existing.archivedAt) {
      return asContentItemOutput<IDeleteContentItemOutput>(existing);
    }

    // An archived course is read-only, so nothing in it is archived either.
    requireCourseNotArchived(course);

    // Archiving keeps a video's S3 objects and any running transcode: the
    // item can be restored.
    await writeInActiveCourse(coreTable, courseId, (entities) => [
      entities.contentItem
        .patch(key)
        .set({ archivedAt: new Date().toISOString() })
        .commit(),
    ]);

    // Transactions don't return the written attributes.
    return asContentItemOutput<IDeleteContentItemOutput>(
      await getContentItemOrThrow(coreTable, key),
    );
  });

// Students still don't see the item until its lesson and module are visible
// too.
export const publishContentItem = courseProcedure
  .input(PublishContentItemInputSchema)
  .output(PublishContentItemOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, lessonId, contentItemId } = input;
    const key = { courseId, moduleId, lessonId, contentItemId };

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    const existing = await getContentItemOrThrow(coreTable, key);
    requireNotArchived(
      existing,
      'Restore the content item before publishing it',
    );
    await requireAncestorsNotArchived(coreTable, key);
    if (existing.visibility === 'visible') {
      return asContentItemOutput<IPublishContentItemOutput>(existing);
    }

    return asContentItemOutput<IPublishContentItemOutput>(
      await setVisibilityUnderActiveAncestors(
        coreTable,
        key,
        { visibility: 'visible', ...firstPublishedAt(existing) },
        'Restore the content item before publishing it',
      ),
    );
  });

export const hideContentItem = courseProcedure
  .input(HideContentItemInputSchema)
  .output(HideContentItemOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, lessonId, contentItemId } = input;
    const key = { courseId, moduleId, lessonId, contentItemId };

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    const existing = await getContentItemOrThrow(coreTable, key);
    requireNotArchived(existing, 'Restore the content item before hiding it');
    await requireAncestorsNotArchived(coreTable, key);
    if (existing.visibility === 'hidden') {
      return asContentItemOutput<IHideContentItemOutput>(existing);
    }

    return asContentItemOutput<IHideContentItemOutput>(
      await setVisibilityUnderActiveAncestors(
        coreTable,
        key,
        { visibility: 'hidden' },
        'Restore the content item before hiding it',
      ),
    );
  });

// A content item under an archived lesson or module can't be restored on its
// own: it would still be hidden by that ancestor, so the ancestor has to come
// back first.
export const restoreContentItem = courseProcedure
  .input(RestoreContentItemInputSchema)
  .output(RestoreContentItemOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, lessonId, contentItemId } = input;
    const key = { courseId, moduleId, lessonId, contentItemId };

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    const existing = await getContentItemOrThrow(coreTable, key);
    if (!existing.archivedAt) {
      return asContentItemOutput<IRestoreContentItemOutput>(existing);
    }
    // An archived course is read-only: restore the course first.
    await requireActiveCourse(coreTable, courseId);

    const [{ data: module }, { data: lesson }] = await Promise.all([
      coreTable.entities.module.get({ courseId, moduleId }).go(),
      coreTable.entities.lesson.get({ courseId, moduleId, lessonId }).go(),
    ]);
    if (!module || !lesson) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireNotArchived(module, 'Restore the module first');
    requireNotArchived(lesson, 'Restore the lesson first');

    // A restored item goes to the end of its lesson; the instructor drags it
    // where they want. Every page: all siblings count.
    const { data: siblings } = await coreTable.entities.contentItem.query
      .primary({ courseId, moduleId, lessonId })
      .go({ pages: 'all' });
    // Conditioned on the module and lesson still being active, so one
    // archived after the checks above doesn't end up with an active item
    // under it.
    await writeUnderActiveAncestors(coreTable, key, (entities) => [
      entities.contentItem
        .patch(key)
        .set({ order: nextOrder(siblings) })
        .remove(['archivedAt'])
        .commit(),
    ]);

    // Transactions don't return the written attributes.
    return asContentItemOutput<IRestoreContentItemOutput>(
      await getContentItemOrThrow(coreTable, key),
    );
  });

// Removes an archived content item for good. Refused once any student has
// activity on it: that data must survive curriculum edits, so such an item
// can stay archived but never be deleted.
export const deleteContentItemPermanently = courseProcedure
  .input(DeleteContentItemPermanentlyInputSchema)
  .output(DeleteContentItemPermanentlyOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, lessonId, contentItemId } = input;
    const key = { courseId, moduleId, lessonId, contentItemId };

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    const existing = await getContentItemOrThrow(coreTable, key);
    if (!existing.archivedAt) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Archive the content item before deleting it permanently',
      });
    }

    if (existing.studentActivityCount > 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message:
          'Students have activity on this content item, so it can stay archived but cannot be deleted permanently',
      });
    }

    // The same conditions again on the delete itself, so a student's first
    // activity or a restore landing after the checks above isn't lost.
    const { data: contentItem } = await coreTable.entities.contentItem
      .delete(key)
      .where(
        (attr, op) =>
          `${op.eq(attr.studentActivityCount, 0)} AND ${op.exists(attr.archivedAt)}`,
      )
      .go({ response: 'all_old' })
      .catch((error: unknown) => {
        if (isConditionalCheckFailed(error)) {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'The content item changed while it was being deleted; retry the delete',
          });
        }
        throw error;
      });
    if (!contentItem) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to delete content item',
      });
    }

    await cleanUpDeletedContentItem(ctx.logger, contentItem);
    return asContentItemOutput<IDeleteContentItemPermanentlyOutput>(
      contentItem,
    );
  });

const lessonContentItemsChanged = () =>
  new TRPCError({
    code: 'CONFLICT',
    message:
      "The lesson's content items changed while you were reordering them; reload and try again",
  });

// Puts the lesson's content items in the given order, writing every `order` in
// one transaction behind the checks on the course, module and lesson, so it
// follows the same archive rules as any other edit: nothing is reordered in an
// archived course, module or lesson. Works the same for every content item
// type. Archived items keep the `order` they had and aren't part of the list.
//
// The list has to be exactly the lesson's items that aren't archived, so a
// client that missed an item added, archived or removed in the meantime gets
// `CONFLICT` and reloads rather than overwriting what it never saw. Repeating
// an order the lesson already has writes nothing.
export const reorderContentItems = courseProcedure
  .input(ReorderContentItemsInputSchema)
  .output(ReorderContentItemsOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, lessonId, contentItemIds } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    await requireAncestorsNotArchived(coreTable, {
      courseId,
      moduleId,
      lessonId,
    });

    if (new Set(contentItemIds).size !== contentItemIds.length) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'A content item can only appear once in the new order',
      });
    }

    // Every page: a lesson's items can exceed a single 1 MB query page.
    const readItems = async () => {
      const { data } = await coreTable.entities.contentItem.query
        .primary({ courseId, moduleId, lessonId })
        .go({ pages: 'all' });
      return data.filter((item) => !item.archivedAt);
    };
    const items = await readItems();
    const byId = new Map(items.map((item) => [item.contentItemId, item]));
    if (
      byId.size !== contentItemIds.length ||
      contentItemIds.some((id) => !byId.has(id))
    ) {
      throw lessonContentItemsChanged();
    }

    // The transaction also carries the checks on the course, module and lesson.
    if (3 + contentItemIds.length > MAX_TRANSACTION_ITEMS) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `This lesson has too many content items to reorder in one operation (the limit is ${MAX_TRANSACTION_ITEMS - 3}).`,
      });
    }

    const unchanged = contentItemIds.every(
      (id, index) => byId.get(id)?.order === index + 1,
    );
    if (!unchanged) {
      // Each item is conditioned on still not being archived, so one archived
      // after the read above is never moved: the whole reorder is refused.
      await writeUnderActiveAncestors(
        coreTable,
        { courseId, moduleId, lessonId },
        (entities) =>
          contentItemIds.map((contentItemId, index) =>
            entities.contentItem
              .patch({ courseId, moduleId, lessonId, contentItemId })
              .set({ order: index + 1 })
              .where((attr, op) => op.notExists(attr.archivedAt))
              .commit(),
          ),
        () => {
          throw lessonContentItemsChanged();
        },
      );
    }

    // Transactions don't return the written attributes.
    return asContentItemOutput<IReorderContentItemsOutput>(
      (await readItems()).sort((a, b) => a.order - b.order),
    );
  });
