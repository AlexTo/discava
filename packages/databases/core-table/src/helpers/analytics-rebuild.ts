/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '../service.js';
import {
  aggregatesOf,
  type Contributions,
  contributions,
  type FunnelStatus,
  funnelContributions,
  funnelStatus,
  sumContributions,
} from './analytics-contributions.js';

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

interface FunnelMarker {
  userId: string;
  lessonId: string;
  status: FunnelStatus;
}

/**
 * The contributions of a course's source records (enrolments, completions,
 * attempts and summaries, and lesson progress against enrolment), and the funnel markers
 * the lesson counts imply.
 */
const courseContributions = async (
  coreTable: CoreTable,
  courseId: string,
): Promise<{ sum: Contributions; funnel: FunnelMarker[] }> => {
  const {
    enrolment,
    itemCompletion,
    quizAttempt,
    quizSummary,
    videoAnswerSheet,
    progress,
  } = coreTable.entities;
  const funnel: FunnelMarker[] = [];
  const { data: enrolments } = await enrolment.query
    .primary({ courseId })
    .go(all);
  const found: Contributions[] = enrolments.map((record) =>
    contributions('enrolment', record),
  );
  // Each student's records by keyed query: their partition, the course's prefix.
  await forEachLimited(enrolments, 10, async (enrolled) => {
    const { userId } = enrolled;
    const [completions, attempts, summaries, sheets, lessons] =
      await Promise.all([
        itemCompletion.query.primary({ userId }).begins({ courseId }).go(all),
        quizAttempt.query.primary({ userId }).begins({ courseId }).go(all),
        quizSummary.query.primary({ userId }).begins({ courseId }).go(all),
        videoAnswerSheet.query.primary({ userId }).begins({ courseId }).go(all),
        progress.query.primary({ userId }).begins({ courseId }).go(all),
      ]);
    for (const record of lessons.data) {
      const status = funnelStatus(record, enrolled);
      if (status) {
        funnel.push({ userId, lessonId: record.lessonId, status });
      }
    }
    found.push(
      ...completions.data.map((record) =>
        contributions('itemCompletion', record),
      ),
      ...attempts.data.map((record) => contributions('quizAttempt', record)),
      ...summaries.data.map((record) => contributions('quizSummary', record)),
      ...sheets.data.map((record) => contributions('videoAnswerSheet', record)),
      funnelContributions(lessons.data, enrolled),
    );
  });
  return { sum: sumContributions(found), funnel };
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
  const { sum, funnel } = await courseContributions(coreTable, courseId);
  const expected = aggregatesOf(sum);
  const {
    courseStats,
    periodStats,
    lessonStats,
    analyticsMarker,
    quizQuestionStats,
    quizScoreStats,
  } = coreTable.entities;

  // The funnel markers say what the lesson items count, so they are replaced
  // with the aggregates (the event and member markers are left alone).
  const { data: oldFunnel } = await analyticsMarker.query
    .primary({ courseId })
    .begins({ markerId: 'FUNNEL#' })
    .go(all);

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
      ...oldFunnel.map(({ markerId }) =>
        analyticsMarker.delete({ courseId, markerId }),
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
    } else if (kind === 'lessonStats') {
      await lessonStats
        .put({ courseId, lessonId: sk.slice('LESSON#'.length), ...counters })
        .go();
    } else if (kind === 'quizQuestionStats') {
      const [contentItemId, questionId] = sk
        .slice('QUIZ#'.length)
        .split('#Q#') as [string, string];
      await quizQuestionStats
        .put({ courseId, contentItemId, questionId, ...counters })
        .go();
    } else if (kind === 'quizScoreStats') {
      await quizScoreStats
        .put({
          courseId,
          contentItemId: sk.slice('QUIZ#'.length, -'#SCORES'.length),
          ...counters,
        })
        .go();
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
  await forEachLimited(funnel, 10, async ({ userId, lessonId, status }) => {
    await analyticsMarker
      .put({ courseId, markerId: `FUNNEL#${userId}#${lessonId}`, status })
      .go();
  });
};
