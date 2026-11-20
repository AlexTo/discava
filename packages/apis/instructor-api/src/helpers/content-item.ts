/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Logger } from '@aws-lambda-powertools/logger';
import type { CoreTable } from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { writeUnderActiveAncestors } from './ancestor-writes.js';
import { requireNotArchived } from './curriculum-guards.js';
import {
  bestEffortCancelTranscodeJobs,
  type ICancelableVideoContentItem,
} from './mediaconvert-client.js';
import {
  bestEffortDeleteContentItemVideos,
  bestEffortRetirePreviousVersions,
  type IDeletableVideoContentItem,
} from './s3-client.js';

export interface ContentItemKey {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
}

// ElectroDB infers a contentItem record as one flat type (every type's
// attributes optional), not a union keyed on `type`. This cast bridges to the
// discriminated-union API types; each call site has already branched on
// `type` or passes the record through unchanged.
export const asContentItemOutput = <T>(contentItem: unknown) =>
  contentItem as T;

// Sets the item's visibility (and, when publishing it for the first time,
// its publishedAt) in one transaction with checks that its module and lesson
// are still active, conditioned on the item itself still not being archived,
// so an archive landing after the caller's own checks can't be written past.
export const setVisibilityUnderActiveAncestors = async (
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

export const getContentItemOrThrow = async (
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

// An assignment lesson (#102) always holds its one item, so the item is
// removed with its lesson, never on its own.
export const requireNotAssignmentItem = async (
  coreTable: CoreTable,
  { courseId, moduleId, lessonId }: ContentItemKey,
) => {
  const { data: lesson } = await coreTable.entities.lesson
    .get({ courseId, moduleId, lessonId })
    .go();
  if (lesson?.kind === 'assignment') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        "An assignment's content can't be deleted on its own. Delete the assignment instead",
    });
  }
};

// Cleans up a deleted item's external storage. Callers pass the record that
// was actually removed (`all_old`, or a read the delete was conditioned on):
// acting on a stale read after a concurrent replacement would cancel or
// delete the wrong job and orphan the real one.
export const cleanUpDeletedContentItem = async (
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
  // A file item's file sits in its own version folder, as a ready video's
  // output does, so the same cleanup retires it (#102).
  if (contentItem.type === 'file' && contentItem.s3Key) {
    await bestEffortDeleteContentItemVideos(logger, [contentItem]);
  }
};
