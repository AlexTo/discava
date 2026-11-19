/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  aggregatesOf,
  contributions,
  funnelContributions,
  questionStatsSk,
  SCORE_BANDS,
  scoreStatsSk,
  sumContributions,
} from '../analytics-contributions.js';
import { type Check, type Violation, violation } from './common.js';
import type { TableSnapshot } from './snapshot.js';

// A course's analytics aggregates equal the sums of what its records
// contribute: `contributions` (helpers/analytics-contributions.ts) summed over its
// enrolments, completions and quiz attempts. The stream handler keeps them
// current a few seconds behind the records, so a check right after a change
// may see a difference that closes (the e2e suite waits, see
// `waitForAnalytics`). A missing item counts as zeros. The summary, period,
// lesson and quiz items are compared. A question's counts come from the
// attempts' `answers` and `correctQuestionIds`, a quiz's score bands from the
// students' `bestScore` (it only rises, check 3 holding it to the best
// attempt, and attempts are never rewritten). A lesson's counts come from each student's `progress` against their
// enrolment (a dropped one counts nothing); the funnel markers are ignored.
export const checkAnalyticsMatchesRecords = (
  snapshot: TableSnapshot,
): Violation[] => {
  const expected = aggregatesOf(
    sumContributions([
      ...snapshot.enrolments.map((r) => contributions('enrolment', r)),
      ...snapshot.itemCompletions.map((r) =>
        contributions('itemCompletion', r),
      ),
      ...snapshot.quizAttempts.map((r) => contributions('quizAttempt', r)),
      ...snapshot.quizSummaries.map((r) => contributions('quizSummary', r)),
      ...snapshot.enrolments.map((enrolled) =>
        funnelContributions(
          snapshot.progress.filter(
            (p) =>
              p.courseId === enrolled.courseId && p.userId === enrolled.userId,
          ),
          enrolled,
        ),
      ),
    ]),
  );
  const stored = [
    ...snapshot.courseStats.map(({ courseId, ...counters }) => ({
      courseId,
      sk: 'SUMMARY',
      counters: counters as Record<string, number | undefined>,
    })),
    ...snapshot.periodStats.map(({ courseId, periodKey, ...counters }) => ({
      courseId,
      sk: periodKey,
      counters: counters as Record<string, number | undefined>,
    })),
    ...snapshot.lessonStats.map(({ courseId, lessonId, ...counters }) => ({
      courseId,
      sk: `LESSON#${lessonId}`,
      counters: counters as Record<string, number | undefined>,
    })),
    ...snapshot.quizQuestionStats.map(
      ({ courseId, contentItemId, questionId, ...counters }) => ({
        courseId,
        sk: questionStatsSk(contentItemId, questionId),
        counters: counters as Record<string, number | undefined>,
      }),
    ),
    ...snapshot.quizScoreStats.map(
      ({ courseId, contentItemId, ...counters }) => ({
        courseId,
        sk: scoreStatsSk(contentItemId),
        counters: counters as Record<string, number | undefined>,
      }),
    ),
  ];

  const items = new Map<
    string,
    {
      courseId: string;
      sk: string;
      expected: Record<string, number>;
      stored: Record<string, number | undefined>;
    }
  >();
  const entry = (courseId: string, sk: string) => {
    const key = `${courseId} ${sk}`;
    const found = items.get(key) ?? { courseId, sk, expected: {}, stored: {} };
    items.set(key, found);
    return found;
  };
  for (const item of expected) {
    entry(item.courseId, item.sk).expected = item.counters;
  }
  for (const item of stored) {
    entry(item.courseId, item.sk).stored = item.counters;
  }

  return [...items.values()].flatMap(({ courseId, sk, expected, stored }) =>
    [...new Set([...Object.keys(expected), ...Object.keys(stored)])]
      .filter((attribute) =>
        [
          'enrolments',
          'completed',
          'dropped',
          'activeLearners',
          'inProgress',
          'attempts',
          'misses',
          ...Array.from({ length: SCORE_BANDS }, (_, band) => `band${band}`),
        ].includes(attribute),
      )
      .flatMap((attribute) => {
        const has = stored[attribute] ?? 0;
        const should = expected[attribute] ?? 0;
        return has === should
          ? []
          : [
              violation(
                'analytics-matches-records',
                { courseId, item: sk },
                `${attribute} is ${has}, but its records add up to ${should}`,
              ),
            ];
      }),
  );
};

export const ANALYTICS_CHECKS = [
  { name: 'analytics-matches-records', check: checkAnalyticsMatchesRecords },
] as const satisfies readonly Check[];
