/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type createCoreTableService,
  publishNotification,
} from '@discava/core-table';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

export const FAN_OUT_PAGE_SIZE = 100;
const CONCURRENCY = 10;

export interface FanOutResult {
  /** Students notified for the first time by this run. */
  created: number;
  /** Students whose notification already existed. */
  duplicates: number;
  /** True when the broadcast was already done, so nothing was read. */
  alreadyDone: boolean;
}

/**
 * Notifies every enrolled student of one `notificationBroadcast`, a page of
 * enrolments at a time. It reads the broadcast's current `cursor` and
 * `status`, not a stream record's image, so a repeated or late record
 * resumes where the last run stopped, and does nothing once `done`. The
 * cursor is saved after each page; a page published twice is harmless because
 * `publishNotification` answers 'duplicate' for a student already notified.
 */
export const fanOutBroadcast = async (
  coreTable: CoreTable,
  broadcastId: string,
): Promise<FanOutResult> => {
  const result: FanOutResult = {
    created: 0,
    duplicates: 0,
    alreadyDone: false,
  };
  const { data: broadcast } = await coreTable.entities.notificationBroadcast
    .get({ id: broadcastId })
    .go();
  if (!broadcast) {
    return result;
  }
  if (broadcast.status === 'done') {
    result.alreadyDone = true;
    return result;
  }

  let cursor: string | null = broadcast.cursor ?? null;
  do {
    const page = await coreTable.entities.enrolment.query
      .primary({ courseId: broadcast.courseId })
      .go({
        limit: FAN_OUT_PAGE_SIZE,
        pages: 1,
        ...(cursor ? { cursor } : {}),
      });
    const students = page.data
      .filter(({ status }) => status !== 'dropped')
      .map(({ userId }) => userId);

    let next = 0;
    await Promise.all(
      Array.from(
        { length: Math.min(CONCURRENCY, students.length) },
        async () => {
          while (next < students.length) {
            const outcome = await publishNotification(coreTable, {
              type: broadcast.type,
              userId: students[next++],
              params: broadcast.params,
              dedupeKey: broadcast.dedupeKey,
              occurredAt: broadcast.occurredAt,
            });
            if (outcome === 'created') {
              result.created++;
            } else {
              result.duplicates++;
            }
          }
        },
      ),
    );

    cursor = page.cursor;
    if (cursor) {
      await coreTable.entities.notificationBroadcast
        .patch({ id: broadcastId })
        .set({ cursor })
        .go();
    }
  } while (cursor);

  await coreTable.entities.notificationBroadcast
    .patch({ id: broadcastId })
    .set({ status: 'done', completedAt: new Date().toISOString() })
    .go();
  return result;
};
