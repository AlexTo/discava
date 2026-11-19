/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// A test helper, not a test file, so the lint override for tests doesn't reach it.
// biome-ignore lint/correctness/noUndeclaredDependencies: vitest is the workspace's test runner
import { expect } from 'vitest';
import {
  aggregatesOf,
  contributions,
  funnelContributions,
  sumContributions,
} from '../analytics.js';
import type { InvariantName } from './index.js';
import { checkTableInvariants as checkAllInvariants } from './index.js';
import type { TableSnapshot } from './snapshot.js';

// Most tests below change a table's records to break one rule, and should not
// also trip the analytics rule because the aggregates no longer match them.
// This checks the table with its aggregates recomputed from its records; the
// rule itself is tested on its own, with `checkAllInvariants`, at the end.
export const checkTableInvariants = (snapshot: TableSnapshot) => {
  const items = aggregatesOf(
    sumContributions([
      ...snapshot.enrolments.map((r) => contributions('enrolment', r)),
      ...snapshot.itemCompletions.map((r) =>
        contributions('itemCompletion', r),
      ),
      ...snapshot.quizAttempts.map((r) => contributions('quizAttempt', r)),
    ]),
  );
  return checkAllInvariants({
    ...snapshot,
    courseStats: items
      .filter(({ kind }) => kind === 'courseStats')
      .map(({ courseId, counters }) => ({
        courseId,
        enrolments: 0,
        completed: 0,
        dropped: 0,
        ...counters,
      })),
    periodStats: items
      .filter(({ kind }) => kind === 'periodStats')
      .map(({ courseId, sk, counters }) => ({
        courseId,
        periodKey: sk,
        enrolments: 0,
        activeLearners: 0,
        ...counters,
      })),
  });
};

export const T = '2026-01-01T00:00:00.000Z';
// When the student did things: the text item, then two quiz attempts.
export const AT = {
  text: '2026-01-02T09:00:00.000Z',
  a1: '2026-01-02T10:00:00.000Z',
  a2: '2026-01-02T10:05:00.000Z',
};
export const ids = { courseId: 'c1', moduleId: 'm1', lessonId: 'l1' };
export const shown = { visibility: 'visible' as const, publishedAt: T };
export const prefix = 'courses/c1/modules/m1/lessons/l1/content-items';

// A published course whose student has done the text item and passed the quiz
// (on their second attempt), but not the video or the file: two of four items,
// so 50% and the lesson in progress. Items are in order: text, quiz, video, file.
export const consistentTable = (): TableSnapshot => ({
  courses: [
    {
      courseId: 'c1',
      status: 'published',
      publishedAt: T,
      updatedAt: T,
      lastChildOrder: 1,
    },
  ],
  modules: [{ ...ids, ...shown, order: 1, lastChildOrder: 1 }],
  lessons: [{ ...ids, ...shown, kind: 'lesson', order: 1, lastChildOrder: 4 }],
  coursePreviews: [],
  contentItems: [
    {
      ...ids,
      ...shown,
      contentItemId: 'text',
      type: 'text',
      status: 'ready',
      order: 1,
      studentActivityCount: 1,
    },
    {
      ...ids,
      ...shown,
      contentItemId: 'quiz',
      type: 'quiz',
      status: 'ready',
      order: 2,
      studentActivityCount: 1,
    },
    {
      ...ids,
      ...shown,
      contentItemId: 'video',
      type: 'video',
      status: 'ready',
      order: 3,
      s3Key: `${prefix}/video/n1/master.m3u8`,
      studentActivityCount: 0,
    },
    {
      ...ids,
      ...shown,
      contentItemId: 'file',
      type: 'file',
      status: 'ready',
      order: 4,
      s3Key: `${prefix}/file/u1/notes.pdf`,
      submissionNonce: 'u1',
      fileName: 'notes.pdf',
      fileSize: 596,
      mimeType: 'application/pdf',
      studentActivityCount: 0,
    },
  ],
  courseInstructors: [
    { courseId: 'c1', instructorId: 'teacher', courseUpdatedAt: T },
  ],
  enrolments: [
    {
      courseId: 'c1',
      userId: 'student',
      status: 'active',
      progressPercent: 50,
      lastActivityAt: AT.a2,
      createdAt: T,
    },
  ],
  itemCompletions: [
    { ...ids, userId: 'student', contentItemId: 'text', completedAt: AT.text },
    { ...ids, userId: 'student', contentItemId: 'quiz', completedAt: AT.a2 },
  ],
  progress: [
    {
      userId: 'student',
      courseId: 'c1',
      lessonId: 'l1',
      status: 'in_progress',
    },
  ],
  quizAttempts: [
    {
      ...ids,
      userId: 'student',
      contentItemId: 'quiz',
      attemptId: 'a1',
      answers: { q1: ['x'], q2: ['y'] },
      correctQuestionIds: ['q1'],
      scorePercent: 40,
      passed: false,
      submittedAt: AT.a1,
    },
    {
      ...ids,
      userId: 'student',
      contentItemId: 'quiz',
      attemptId: 'a2',
      answers: { q1: ['x'], q2: ['z'] },
      correctQuestionIds: ['q1', 'q2'],
      scorePercent: 80,
      passed: true,
      submittedAt: AT.a2,
    },
  ],
  quizSummaries: [
    {
      ...ids,
      userId: 'student',
      contentItemId: 'quiz',
      attemptsUsed: 2,
      bestScore: 80,
      bestAttemptId: 'a2',
      passedAt: T,
    },
  ],
  assignmentSubmissions: [],
  certificates: [],
  videoPositions: [],
  users: [{ userId: 'teacher' }, { userId: 'student' }],
  // What the stream handler leaves for the records above: one enrolment on
  // 1 January, and the student active on 2 January (week 1 of 2026).
  courseStats: [{ courseId: 'c1', enrolments: 1, completed: 0, dropped: 0 }],
  periodStats: [
    {
      courseId: 'c1',
      periodKey: 'DAY#2026-01-01',
      enrolments: 1,
      activeLearners: 0,
    },
    {
      courseId: 'c1',
      periodKey: 'DAY#2026-01-02',
      enrolments: 0,
      activeLearners: 1,
    },
    {
      courseId: 'c1',
      periodKey: 'WEEK#2026-W01',
      enrolments: 0,
      activeLearners: 1,
    },
  ],
  lessonStats: [
    { courseId: 'c1', lessonId: 'l1', inProgress: 1, completed: 0 },
  ],
  // The two attempts answered q1 and q2; q2 was missed once. The best score
  // of 80 is in band 8.
  quizQuestionStats: [
    {
      courseId: 'c1',
      contentItemId: 'quiz',
      questionId: 'q1',
      attempts: 2,
      misses: 0,
    },
    {
      courseId: 'c1',
      contentItemId: 'quiz',
      questionId: 'q2',
      attempts: 2,
      misses: 1,
    },
  ],
  quizScoreStats: [
    {
      courseId: 'c1',
      contentItemId: 'quiz',
      ...{ band0: 0, band1: 0, band2: 0, band3: 0, band4: 0 },
      ...{ band5: 0, band6: 0, band7: 0, band8: 1, band9: 0 },
    },
  ],
  notifications: [],
  notificationStates: [],
  notificationPreferences: [],
  notificationBroadcasts: [],
  announcements: [],
  categories: [],
  categoryClaims: [],
  discussionPosts: [],
  discussionVotes: [],

  reviews: [],
  courseRatings: [],
  instructorProfiles: [
    {
      instructorId: 'teacher',
      handle: 'the-teacher',
      displayName: 'The Teacher',
      version: 1,
    },
  ],
  profileHandleClaims: [{ handle: 'the-teacher', instructorId: 'teacher' }],
  coupons: [],
  couponRedemptions: [],
});

// The helpers a topic's tests share, working on whichever table the test file
// holds (`getTable()` is read each time, since a test may replace it).
export const testHelpers = (getTable: () => TableSnapshot) => {
  const item = (contentItemId: string) => {
    const found = getTable().contentItems.find(
      (i) => i.contentItemId === contentItemId,
    );
    if (!found) throw new Error(`no item ${contentItemId}`);
    return found;
  };

  // The lesson figures the records add up to, as the analytics handler would
  // have left them, for a test that changes progress or an enrolment to try
  // another rule; rule 26 is tried against its own figures below.
  const settleLessonStats = () => {
    getTable().lessonStats = aggregatesOf(
      sumContributions(
        getTable().enrolments.map((enrolled) =>
          funnelContributions(
            getTable().progress.filter(
              (p) =>
                p.courseId === enrolled.courseId &&
                p.userId === enrolled.userId,
            ),
            enrolled,
          ),
        ),
      ),
    ).map(({ courseId, sk, counters }) => ({
      courseId,
      lessonId: sk.slice('LESSON#'.length),
      inProgress: counters.inProgress ?? 0,
      completed: counters.completed ?? 0,
    }));
  };

  // The same for the quiz figures, for a test that changes an attempt or a
  // summary to try another rule.
  const settleQuizStats = () => {
    const items = aggregatesOf(
      sumContributions([
        ...getTable().quizAttempts.map((r) => contributions('quizAttempt', r)),
        ...getTable().quizSummaries.map((r) => contributions('quizSummary', r)),
      ]),
    );
    getTable().quizQuestionStats = items
      .filter(({ kind }) => kind === 'quizQuestionStats')
      .map(({ courseId, sk, counters }) => {
        const [contentItemId, questionId] = sk.slice(5).split('#Q#');
        return {
          courseId,
          contentItemId,
          questionId,
          attempts: counters.attempts ?? 0,
          misses: counters.misses ?? 0,
        };
      });
    getTable().quizScoreStats = items
      .filter(({ kind }) => kind === 'quizScoreStats')
      .map(({ courseId, sk, counters }) => ({
        courseId,
        contentItemId: sk.slice(5, -'#SCORES'.length),
        ...Object.fromEntries(
          Array.from({ length: 10 }, (_, b) => [
            `band${b}`,
            counters[`band${b}`] ?? 0,
          ]),
        ),
      })) as TableSnapshot['quizScoreStats'];
  };

  // The invariants broken, each once, with the messages.
  const broken = () => {
    settleLessonStats();
    settleQuizStats();
    const violations = checkTableInvariants(getTable());
    return {
      invariants: [...new Set(violations.map((v) => v.invariant))],
      messages: violations.map((v) => v.message),
      violations,
    };
  };

  const expectOnly = (invariant: InvariantName, message?: RegExp) => {
    const { invariants, messages } = broken();
    expect(invariants).toEqual([invariant]);
    if (message) {
      expect(messages).toContainEqual(expect.stringMatching(message));
    }
  };

  return {
    item,
    settleLessonStats,
    settleQuizStats,
    broken,
    expectOnly,
  };
};
