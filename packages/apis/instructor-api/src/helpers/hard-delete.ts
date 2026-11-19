/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Logger } from '@aws-lambda-powertools/logger';
import { transactionConflict } from '@discava/common-server-utils/trpc-api-base';
import {
  type CoreTable,
  cancellationReasons,
  failedAt,
  hasTransactionConflict,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import {
  MAX_TRANSACTION_ITEMS,
  type TransactionEntities,
  type TransactionItems,
} from './ancestor-writes.js';
import { courseNoLongerDraft, draftCourseCheck } from './curriculum-guards.js';
import {
  bestEffortCancelTranscodeJobs,
  type ICancelableVideoContentItem,
} from './mediaconvert-client.js';
import {
  bestEffortDeleteContentItemVideos,
  bestEffortRetirePreviousVersions,
  type IDeletableVideoContentItem,
} from './s3-client.js';

export interface IHardDeleteCurriculumNodeOptions {
  courseId: string;
  moduleId: string;
  // The node's delete (a module's or a lesson's), conditioned on
  // `checkedArchivedAt` when that's given. It is the transaction's first item.
  deleteNode: (
    entities: TransactionEntities,
    checkedArchivedAt: string | undefined,
  ) => TransactionItems[number];
  // The lessons deleted along with the node (a module's); none for a lesson.
  lessons?: { lessonId: string }[];
  contentItems: (ICancelableVideoContentItem &
    IDeletableVideoContentItem & { updatedAt: string; type: string })[];
  // The archivedAt the caller checked: the node delete is then conditioned on
  // it being unchanged, so a restore (or a restore and re-archive) landing
  // after that check cancels the delete.
  checkedArchivedAt?: string;
  // Set for a delete in a draft course: the delete lands only while the course
  // is still a draft.
  draftCourseId?: string;
  messages: {
    tooMany: string;
    restoredOrChanged: string;
    contentItemChanged: string;
    failed: string;
  };
}

// Deletes a module or lesson with everything under it, for good. Nothing
// limits how many children a node can hold, so one too large for a single
// transactional cascade is refused. Everything goes in one transaction, so a
// failure partway through can't leave an orphaned lesson or content item
// referencing a node that no longer exists.
export const hardDeleteCurriculumNode = async (
  coreTable: CoreTable,
  logger: Logger | undefined,
  {
    courseId,
    moduleId,
    deleteNode,
    lessons = [],
    contentItems,
    checkedArchivedAt,
    draftCourseId,
    messages,
  }: IHardDeleteCurriculumNodeOptions,
) => {
  if (
    1 +
      lessons.length +
      contentItems.length +
      (draftCourseId === undefined ? 0 : 1) >
    MAX_TRANSACTION_ITEMS
  ) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: messages.tooMany,
    });
  }

  // Each content item delete is conditioned on:
  // - updatedAt (bumped by every write -- see the contentItem entity's
  //   `watch: '*'`) still matching the queried snapshot. Without this, a
  //   content item that changes between the query and this transaction --
  //   most notably a transcode completing and publishing its HLS output --
  //   would still be deleted, but the cleanup below would act on the stale
  //   snapshot instead of what was actually removed. A transaction returns
  //   no deleted attributes to clean up from instead, so this can only
  //   reject and ask the caller to retry;
  // - studentActivityCount = 0, checked directly rather than through
  //   updatedAt: a millisecond-precision timestamp can come out the same
  //   for a write in the same millisecond (or from another machine's
  //   clock), and student data must never be deleted.
  const { canceled, data: transactionResults } = await coreTable.transaction
    .write((entities) => [
      deleteNode(entities, checkedArchivedAt),
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
    // The node is the transaction's first item.
    const results = cancellationReasons(transactionResults);
    // The draft check, when there is one, is its last.
    if (draftCourseId !== undefined && failedAt(results, results.length - 1)) {
      throw courseNoLongerDraft();
    }
    if (failedAt(results, 0)) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: messages.restoredOrChanged,
      });
    }
    const staleContentItem = failedAt(results, 1, results.length);
    // Another transaction touching the same records at that moment.
    if (!staleContentItem && hasTransactionConflict(results)) {
      throw transactionConflict();
    }
    throw new TRPCError({
      code: staleContentItem ? 'CONFLICT' : 'INTERNAL_SERVER_ERROR',
      message: staleContentItem ? messages.contentItemChanged : messages.failed,
    });
  }

  // Best-effort: the DynamoDB records are the source of truth for the
  // node's content, so a failure to remove the underlying S3 objects is
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
