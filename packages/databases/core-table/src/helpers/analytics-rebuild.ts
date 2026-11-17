/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '../service.js';
import {
  aggregatesOf,
  type Contributions,
  contributions,
  sumContributions,
} from './analytics.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

const all = { pages: 'all' } as const;

// Runs `task` for every item, at most `limit` at a time.
const forEachLimited = async <T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
) => {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        await task(items[next++]);
      }
    }),
  );
};

/** The contributions of a course's source records: enrolments, completions, attempts. */
const courseContributions = async (
  coreTable: CoreTable,
  courseId: string,
): Promise<Contributions> => {
  const { enrolment, itemCompletion, quizAttempt } = coreTable.entities;
  const { data: enrolments } = await enrolment.query
    .primary({ courseId })
    .go(all);
  const found: Contributions[] = enrolments.map((record) =>
    contributions('enrolment', record),
  );
  // Each student's records by keyed query: their partition, the course's prefix.
  await forEachLimited(enrolments, 10, async ({ userId }) => {
    const [completions, attempts] = await Promise.all([
      itemCompletion.query.primary({ userId }).begins({ courseId }).go(all),
      quizAttempt.query.primary({ userId }).begins({ courseId }).go(all),
    ]);
    found.push(
      ...completions.data.map((record) =>
        contributions('itemCompletion', record),
      ),
      ...attempts.data.map((record) => contributions('quizAttempt', record)),
    );
  });
  return sumContributions(found);
};

/**
 * Replaces a course's aggregate items with what its records add up to. Tooling
 * for repairing drift or backfilling a course, never called from a request;
 * the markers are left alone, so the stream's redelivered changes are still
 * recognised. Running it twice gives the same items.
 */
export const rebuildCourseAnalytics = async (
  coreTable: CoreTable,
  courseId: string,
): Promise<void> => {
  const expected = aggregatesOf(await courseContributions(coreTable, courseId));
  const {
    courseStats,
    periodStats,
    lessonStats,
    quizQuestionStats,
    quizScoreStats,
  } = coreTable.entities;

  const stored = await coreTable.collections.analytics({ courseId }).go(all);
  await forEachLimited(
    [
      ...stored.data.courseStats.map(() => courseStats.delete({ courseId })),
      ...stored.data.periodStats.map(({ periodKey }) =>
        periodStats.delete({ courseId, periodKey }),
      ),
      ...stored.data.lessonStats.map(({ lessonId }) =>
        lessonStats.delete({ courseId, lessonId }),
      ),
      ...stored.data.quizQuestionStats.map(({ contentItemId, questionId }) =>
        quizQuestionStats.delete({ courseId, contentItemId, questionId }),
      ),
      ...stored.data.quizScoreStats.map(({ contentItemId }) =>
        quizScoreStats.delete({ courseId, contentItemId }),
      ),
    ],
    10,
    async (deletion) => {
      await deletion.go();
    },
  );

  const now = new Date().toISOString();
  await forEachLimited(expected, 10, async ({ kind, sk, counters }) => {
    if (kind === 'courseStats') {
      await courseStats.put({ courseId, ...counters, updatedAt: now }).go();
    } else {
      await periodStats
        .put({
          courseId,
          periodKey: sk,
          period: sk.startsWith('DAY#') ? 'day' : 'week',
          ...counters,
        })
        .go();
    }
  });
};
