/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  aggregatesOf,
  contributions,
  contributionsOfChange,
  dayKey,
  funnelContributions,
  funnelStatus,
  funnelTasksOfChange,
  mergeCounts,
  sumContributions,
  weekKey,
} from './analytics-contributions.js';
import { rebuildCourseAnalytics } from './analytics-rebuild.js';

const enrolment = (overrides: Record<string, unknown> = {}) => ({
  courseId: 'c1',
  userId: 'u1',
  status: 'active',
  createdAt: '2026-11-16T10:00:00.000Z',
  ...overrides,
});

const amount = (
  { counts }: ReturnType<typeof contributions>,
  sk: string,
  attribute: string,
) => counts.find((d) => d.sk === sk && d.attribute === attribute)?.amount ?? 0;

describe('dayKey and weekKey', () => {
  it('puts 23:59:59 and 00:00:00 on different UTC days', () => {
    expect(dayKey('2026-11-16T23:59:59.999Z')).toBe('DAY#2026-11-16');
    expect(dayKey('2026-11-17T00:00:00.000Z')).toBe('DAY#2026-11-17');
  });

  it('uses UTC whatever the offset written', () => {
    expect(dayKey('2026-11-17T01:00:00.000+05:00')).toBe('DAY#2026-11-16');
  });

  it('numbers ISO weeks from Monday to Sunday', () => {
    expect(weekKey('2026-11-15T23:59:59Z')).toBe('WEEK#2026-W46'); // Sunday
    expect(weekKey('2026-11-16T00:00:00Z')).toBe('WEEK#2026-W47'); // Monday
    expect(weekKey('2026-11-22T23:59:59Z')).toBe('WEEK#2026-W47');
  });

  it('numbers a week by the year of its Thursday', () => {
    expect(weekKey('2020-12-31T12:00:00Z')).toBe('WEEK#2020-W53');
    expect(weekKey('2021-01-03T12:00:00Z')).toBe('WEEK#2020-W53');
    expect(weekKey('2021-01-04T12:00:00Z')).toBe('WEEK#2021-W01');
    expect(weekKey('2024-12-30T12:00:00Z')).toBe('WEEK#2025-W01');
  });

  it('gives nothing for something that is not an instant', () => {
    expect(dayKey('not a date')).toBeUndefined();
    expect(weekKey('')).toBeUndefined();
  });
});

describe('contributions of an enrolment', () => {
  it('counts the enrolment on the summary and on its UTC day', () => {
    const result = contributions('enrolment', enrolment());
    expect(amount(result, 'SUMMARY', 'enrolments')).toBe(1);
    expect(amount(result, 'DAY#2026-11-16', 'enrolments')).toBe(1);
    expect(amount(result, 'SUMMARY', 'completed')).toBe(0);
    expect(amount(result, 'SUMMARY', 'dropped')).toBe(0);
  });

  it('counts a completed enrolment as completed, and a dropped one as dropped', () => {
    expect(
      amount(
        contributions('enrolment', enrolment({ status: 'completed' })),
        'SUMMARY',
        'completed',
      ),
    ).toBe(1);
    expect(
      amount(
        contributions('enrolment', enrolment({ status: 'dropped' })),
        'SUMMARY',
        'dropped',
      ),
    ).toBe(1);
  });

  it('gives nothing for a missing image or an unrelated entity', () => {
    expect(contributions('enrolment', undefined)).toEqual({
      counts: [],
      members: [],
    });
    expect(contributions('lesson', { courseId: 'c1' }).counts).toEqual([]);
  });
});

describe('contributionsOfChange', () => {
  it('counts a new enrolment in full', () => {
    const { counts } = contributionsOfChange(
      'enrolment',
      undefined,
      enrolment(),
    );
    expect(counts).toHaveLength(2);
  });

  it('moves a count when the status changes, and counts the enrolment once', () => {
    const { counts } = contributionsOfChange(
      'enrolment',
      enrolment(),
      enrolment({ status: 'completed' }),
    );
    expect(counts).toEqual([
      expect.objectContaining({
        sk: 'SUMMARY',
        attribute: 'completed',
        amount: 1,
      }),
    ]);
  });

  it('moves a count from completed to dropped', () => {
    const { counts } = contributionsOfChange(
      'enrolment',
      enrolment({ status: 'completed' }),
      enrolment({ status: 'dropped' }),
    );
    expect(counts.map(({ attribute, amount }) => [attribute, amount])).toEqual(
      expect.arrayContaining([
        ['dropped', 1],
        ['completed', -1],
      ]),
    );
    expect(counts).toHaveLength(2);
  });

  it('subtracts a removed enrolment', () => {
    const { counts } = contributionsOfChange(
      'enrolment',
      enrolment(),
      undefined,
    );
    expect(counts.every(({ amount }) => amount === -1)).toBe(true);
    expect(counts).toHaveLength(2);
  });

  it('adds activated on the summary and the enrolment day at first activity only', () => {
    const active = enrolment({ lastActivityAt: '2026-11-17T09:00:00.000Z' });
    const first = contributionsOfChange('enrolment', enrolment(), active);
    expect(
      first.counts.map(({ sk, attribute, amount }) => [sk, attribute, amount]),
    ).toEqual(
      expect.arrayContaining([
        ['SUMMARY', 'activated', 1],
        ['DAY#2026-11-16', 'activated', 1],
      ]),
    );
    expect(first.counts).toHaveLength(2);
    const later = contributionsOfChange(
      'enrolment',
      active,
      enrolment({ lastActivityAt: '2026-11-18T09:00:00.000Z' }),
    );
    expect(later.counts).toEqual([]);
  });

  it('keeps activated when an active enrolment is dropped', () => {
    const { counts } = contributionsOfChange(
      'enrolment',
      enrolment({ lastActivityAt: '2026-11-17T09:00:00.000Z' }),
      enrolment({
        lastActivityAt: '2026-11-17T09:00:00.000Z',
        status: 'dropped',
      }),
    );
    expect(counts.some(({ attribute }) => attribute === 'activated')).toBe(
      false,
    );
  });

  it('takes activated back when an activated enrolment is removed', () => {
    const { counts } = contributionsOfChange(
      'enrolment',
      enrolment({ lastActivityAt: '2026-11-17T09:00:00.000Z' }),
      undefined,
    );
    expect(
      counts.filter(({ attribute }) => attribute === 'activated'),
    ).toHaveLength(2);
    expect(counts.every(({ amount }) => amount === -1)).toBe(true);
    expect(counts).toHaveLength(4);
  });

  it('does not count an empty lastActivityAt as activated', () => {
    expect(
      amount(
        contributions('enrolment', enrolment({ lastActivityAt: '' })),
        'SUMMARY',
        'activated',
      ),
    ).toBe(0);
  });

  it('counts the prompt answered or dismissed on the summary', () => {
    const answered = contributionsOfChange(
      'enrolment',
      enrolment(),
      enrolment({ firstLessonPromptState: 'answered' }),
    );
    expect(answered.counts).toEqual([
      expect.objectContaining({
        sk: 'SUMMARY',
        attribute: 'promptAnswered',
        amount: 1,
      }),
    ]);
    const dismissed = contributionsOfChange(
      'enrolment',
      enrolment(),
      enrolment({ firstLessonPromptState: 'dismissed' }),
    );
    expect(dismissed.counts).toEqual([
      expect.objectContaining({
        sk: 'SUMMARY',
        attribute: 'promptDismissed',
        amount: 1,
      }),
    ]);
  });

  it('gives nothing when neither image exists', () => {
    expect(contributionsOfChange('enrolment', undefined, undefined)).toEqual({
      counts: [],
      members: [],
    });
  });

  // The stream delivers at least once and unordered, so what a change adds
  // must not depend on the order changes are applied in.
  it('sums to the same whichever order two changes of one record come in', () => {
    const a = enrolment();
    const b = enrolment({ status: 'completed' });
    const c = enrolment({ status: 'dropped' });
    const first = contributionsOfChange('enrolment', a, b);
    const second = contributionsOfChange('enrolment', b, c);
    expect(mergeCounts([...first.counts, ...second.counts])).toEqual(
      mergeCounts([...second.counts, ...first.counts]),
    );
    expect(mergeCounts([...first.counts, ...second.counts])).toEqual(
      contributionsOfChange('enrolment', a, c).counts,
    );
  });
});

describe('contributions of activity', () => {
  it('makes an item completion a member of its day and week', () => {
    const { counts, members } = contributions('itemCompletion', {
      courseId: 'c1',
      userId: 'u1',
      completedAt: '2026-11-17T08:00:00.000Z',
    });
    expect(counts).toEqual([]);
    expect(members).toEqual([
      { courseId: 'c1', period: 'DAY#2026-11-17', userId: 'u1' },
      { courseId: 'c1', period: 'WEEK#2026-W47', userId: 'u1' },
    ]);
  });

  it('makes a quiz attempt a member on its submittedAt', () => {
    const { members } = contributions('quizAttempt', {
      courseId: 'c1',
      userId: 'u1',
      submittedAt: '2026-11-15T23:00:00.000Z',
    });
    expect(members.map(({ period }) => period)).toEqual([
      'DAY#2026-11-15',
      'WEEK#2026-W46',
    ]);
  });

  it('counts a learner once a day, and once in a week active on two days', () => {
    const at = (completedAt: string) =>
      contributions('itemCompletion', {
        courseId: 'c1',
        userId: 'u1',
        completedAt,
      });
    const sum = sumContributions([
      at('2026-11-16T08:00:00.000Z'),
      at('2026-11-16T09:00:00.000Z'),
      at('2026-11-17T09:00:00.000Z'),
    ]);
    const counters = Object.fromEntries(
      aggregatesOf(sum).map(({ sk, counters }) => [sk, counters]),
    );
    expect(counters['DAY#2026-11-16']).toEqual({ activeLearners: 1 });
    expect(counters['DAY#2026-11-17']).toEqual({ activeLearners: 1 });
    expect(counters['WEEK#2026-W47']).toEqual({ activeLearners: 1 });
  });

  // Activity happened: a drop moves the enrolment's counts, but never takes a
  // learner out of the periods they were active in.
  it('keeps a dropped student active in the periods they were', () => {
    const dropped = contributionsOfChange(
      'enrolment',
      enrolment(),
      enrolment({ status: 'dropped' }),
    );
    expect(dropped.members).toEqual([]);
    expect(dropped.counts).toEqual([
      expect.objectContaining({ attribute: 'dropped', amount: 1 }),
    ]);
  });

  it('never takes a member back, even when the record is removed', () => {
    const removed = contributionsOfChange(
      'itemCompletion',
      { courseId: 'c1', userId: 'u1', completedAt: '2026-11-17T08:00:00Z' },
      undefined,
    );
    expect(removed).toEqual({ counts: [], members: [] });
  });
});

describe('lesson funnel', () => {
  const progress = (status: string, lessonId = 'l1') => ({
    courseId: 'c1',
    userId: 'u1',
    lessonId,
    status,
  });

  it('counts in_progress and completed lessons, and not_started nothing', () => {
    expect(funnelStatus(progress('in_progress'), enrolment())).toBe(
      'inProgress',
    );
    expect(funnelStatus(progress('completed'), enrolment())).toBe('completed');
    expect(funnelStatus(progress('not_started'), enrolment())).toBeUndefined();
  });

  it('counts a completed enrolment’s lessons, but not a dropped one’s', () => {
    expect(
      funnelStatus(progress('completed'), enrolment({ status: 'completed' })),
    ).toBe('completed');
    expect(
      funnelStatus(progress('completed'), enrolment({ status: 'dropped' })),
    ).toBeUndefined();
    expect(funnelStatus(progress('completed'), undefined)).toBeUndefined();
    expect(funnelStatus(undefined, enrolment())).toBeUndefined();
  });

  it('is not part of a progress record’s delta contributions', () => {
    expect(contributions('progress', progress('completed'))).toEqual({
      counts: [],
      members: [],
    });
  });

  it('sums a student’s lessons on their lesson items', () => {
    const sum = funnelContributions(
      [
        progress('completed', 'l1'),
        progress('in_progress', 'l2'),
        progress('not_started', 'l3'),
      ],
      enrolment(),
    );
    expect(amount(sum, 'LESSON#l1', 'completed')).toBe(1);
    expect(amount(sum, 'LESSON#l2', 'inProgress')).toBe(1);
    expect(sum.counts).toHaveLength(2);
    expect(aggregatesOf(sum)).toContainEqual({
      kind: 'lessonStats',
      courseId: 'c1',
      sk: 'LESSON#l1',
      counters: { completed: 1 },
    });
  });

  it('gives nothing for a dropped student’s lessons', () => {
    expect(
      funnelContributions(
        [progress('completed')],
        enrolment({ status: 'dropped' }),
      ).counts,
    ).toEqual([]);
  });

  describe('funnelTasksOfChange', () => {
    it('names the lesson of a progress change, created, changed or removed', () => {
      const task = { courseId: 'c1', userId: 'u1', lessonId: 'l1' };
      expect(
        funnelTasksOfChange('progress', undefined, progress('in_progress')),
      ).toEqual([task]);
      expect(
        funnelTasksOfChange(
          'progress',
          progress('in_progress'),
          progress('completed'),
        ),
      ).toEqual([task]);
      expect(
        funnelTasksOfChange('progress', progress('completed'), undefined),
      ).toEqual([task]);
    });

    it('names the whole student when an enrolment drops, returns, appears or goes', () => {
      const student = [{ courseId: 'c1', userId: 'u1' }];
      const dropped = enrolment({ status: 'dropped' });
      expect(funnelTasksOfChange('enrolment', enrolment(), dropped)).toEqual(
        student,
      );
      expect(funnelTasksOfChange('enrolment', dropped, enrolment())).toEqual(
        student,
      );
      expect(funnelTasksOfChange('enrolment', undefined, enrolment())).toEqual(
        student,
      );
      expect(funnelTasksOfChange('enrolment', enrolment(), undefined)).toEqual(
        student,
      );
    });

    it('names nothing for an enrolment change that keeps it counting', () => {
      expect(
        funnelTasksOfChange(
          'enrolment',
          enrolment(),
          enrolment({ status: 'completed' }),
        ),
      ).toEqual([]);
      expect(funnelTasksOfChange('quizAttempt', undefined, {})).toEqual([]);
    });
  });
});

describe('aggregatesOf', () => {
  it('turns contributions into the items they amount to', () => {
    const sum = sumContributions([
      contributions('enrolment', enrolment()),
      contributions(
        'enrolment',
        enrolment({ userId: 'u2', status: 'dropped' }),
      ),
    ]);
    expect(aggregatesOf(sum)).toEqual(
      expect.arrayContaining([
        {
          kind: 'courseStats',
          courseId: 'c1',
          sk: 'SUMMARY',
          counters: { enrolments: 2, dropped: 1 },
        },
        {
          kind: 'periodStats',
          courseId: 'c1',
          sk: 'DAY#2026-11-16',
          counters: { enrolments: 2 },
        },
      ]),
    );
  });
});

// A course's records in memory, as the rebuild reads them.
const fakeCoreTable = (records: {
  enrolments: Record<string, unknown>[];
  itemCompletions?: Record<string, unknown>[];
  quizAttempts?: Record<string, unknown>[];
  videoAnswerSheets?: Record<string, unknown>[];
  progress?: Record<string, unknown>[];
  funnelMarkers?: Record<string, unknown>[];
  quizSummaries?: Record<string, unknown>[];
  stored?: Record<string, Record<string, unknown>[]>;
}) => {
  const deletes: unknown[] = [];
  const puts: Record<string, unknown>[] = [];
  const ofUser = (all: Record<string, unknown>[] = []) => ({
    query: {
      primary: ({ userId }: { userId: string }) => ({
        begins: () => ({
          go: async () => ({
            data: all.filter((record) => record.userId === userId),
          }),
        }),
      }),
    },
  });
  const deleter = (kind: string) => ({
    delete: (key: unknown) => ({
      go: async () => {
        deletes.push({ kind, key });
      },
    }),
  });
  const putter = (kind: string) => ({
    ...deleter(kind),
    put: (item: Record<string, unknown>) => ({
      go: async () => {
        puts.push({ kind, ...item });
      },
    }),
  });
  const coreTable = {
    entities: {
      enrolment: {
        query: {
          primary: () => ({ go: async () => ({ data: records.enrolments }) }),
        },
      },
      itemCompletion: ofUser(records.itemCompletions),
      quizAttempt: ofUser(records.quizAttempts),
      quizSummary: ofUser(records.quizSummaries),
      videoAnswerSheet: ofUser(records.videoAnswerSheets),
      progress: ofUser(records.progress),
      analyticsMarker: {
        ...putter('analyticsMarker'),
        query: {
          primary: () => ({
            begins: () => ({
              go: async () => ({ data: records.funnelMarkers ?? [] }),
            }),
          }),
        },
      },
      courseStats: putter('courseStats'),
      periodStats: putter('periodStats'),
      lessonStats: putter('lessonStats'),
      quizQuestionStats: putter('quizQuestionStats'),
      quizScoreStats: putter('quizScoreStats'),
    },
    collections: {
      analytics: () => ({
        go: async () => ({
          data: {
            courseStats: [],
            periodStats: [],
            lessonStats: [],
            quizQuestionStats: [],
            quizScoreStats: [],
            ...records.stored,
          },
        }),
      }),
    },
  };
  return { coreTable: coreTable as never, deletes, puts };
};

describe('rebuildCourseAnalytics', () => {
  it('writes the sums of the contributions over the course records', async () => {
    const { coreTable, puts } = fakeCoreTable({
      enrolments: [
        enrolment(),
        enrolment({ userId: 'u2', status: 'completed' }),
      ],
      itemCompletions: [
        { courseId: 'c1', userId: 'u1', completedAt: '2026-11-17T08:00:00Z' },
        { courseId: 'c1', userId: 'u1', completedAt: '2026-11-17T09:00:00Z' },
      ],
    });
    await rebuildCourseAnalytics(coreTable, 'c1');

    expect(puts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'courseStats',
          courseId: 'c1',
          enrolments: 2,
          completed: 1,
        }),
        expect.objectContaining({
          kind: 'periodStats',
          periodKey: 'DAY#2026-11-16',
          period: 'day',
          enrolments: 2,
        }),
        expect.objectContaining({
          kind: 'periodStats',
          periodKey: 'WEEK#2026-W47',
          period: 'week',
          activeLearners: 1,
        }),
      ]),
    );
  });

  it('writes lesson counts and funnel markers, leaving out dropped students', async () => {
    const { coreTable, puts } = fakeCoreTable({
      enrolments: [enrolment(), enrolment({ userId: 'u2', status: 'dropped' })],
      progress: [
        { courseId: 'c1', userId: 'u1', lessonId: 'l1', status: 'completed' },
        { courseId: 'c1', userId: 'u1', lessonId: 'l2', status: 'in_progress' },
        { courseId: 'c1', userId: 'u1', lessonId: 'l3', status: 'not_started' },
        { courseId: 'c1', userId: 'u2', lessonId: 'l1', status: 'completed' },
      ],
    });
    await rebuildCourseAnalytics(coreTable, 'c1');

    const lessons = puts.filter(({ kind }) => kind === 'lessonStats');
    expect(lessons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lessonId: 'l1', completed: 1 }),
        expect.objectContaining({ lessonId: 'l2', inProgress: 1 }),
      ]),
    );
    expect(lessons).toHaveLength(2);
    expect(puts.filter(({ kind }) => kind === 'analyticsMarker')).toEqual([
      expect.objectContaining({
        markerId: 'FUNNEL#u1#l1',
        status: 'completed',
      }),
      expect.objectContaining({
        markerId: 'FUNNEL#u1#l2',
        status: 'inProgress',
      }),
    ]);
  });

  it('replaces the old funnel markers with the new ones', async () => {
    const { coreTable, deletes } = fakeCoreTable({
      enrolments: [],
      funnelMarkers: [{ courseId: 'c1', markerId: 'FUNNEL#u1#l1' }],
    });
    await rebuildCourseAnalytics(coreTable, 'c1');
    expect(deletes).toEqual([
      {
        kind: 'analyticsMarker',
        key: { courseId: 'c1', markerId: 'FUNNEL#u1#l1' },
      },
    ]);
  });

  it('deletes the stored aggregate items first', async () => {
    const { coreTable, deletes } = fakeCoreTable({
      enrolments: [],
      stored: {
        courseStats: [{ courseId: 'c1' }],
        periodStats: [{ courseId: 'c1', periodKey: 'DAY#2026-11-01' }],
      },
    });
    await rebuildCourseAnalytics(coreTable, 'c1');
    expect(deletes).toEqual([
      { kind: 'courseStats', key: { courseId: 'c1' } },
      {
        kind: 'periodStats',
        key: { courseId: 'c1', periodKey: 'DAY#2026-11-01' },
      },
    ]);
  });

  it('gives the same items when run twice', async () => {
    const records = { enrolments: [enrolment()] };
    const first = fakeCoreTable(records);
    const second = fakeCoreTable(records);
    vi.useFakeTimers().setSystemTime(new Date('2026-11-17T00:00:00Z'));
    try {
      await rebuildCourseAnalytics(first.coreTable, 'c1');
      await rebuildCourseAnalytics(second.coreTable, 'c1');
    } finally {
      vi.useRealTimers();
    }
    expect(second.puts).toEqual(first.puts);
  });
});

const attempt = (overrides: Record<string, unknown> = {}) => ({
  courseId: 'c1',
  contentItemId: 'quiz1',
  userId: 'u1',
  submittedAt: '2026-11-17T08:00:00.000Z',
  answers: { q1: ['a'], q2: ['b'], q3: ['c'] },
  correctQuestionIds: ['q1'],
  ...overrides,
});

const summary = (bestScore: unknown, overrides = {}) => ({
  courseId: 'c1',
  contentItemId: 'quiz1',
  userId: 'u1',
  bestScore,
  ...overrides,
});

const questionSk = (questionId: string) => `QUIZ#quiz1#Q#${questionId}`;

describe('contributions of a quiz attempt', () => {
  it('counts an attempt on each answered question and a miss on each not correct', () => {
    const result = contributions('quizAttempt', attempt());
    const quizCounts = result.counts.filter(
      ({ kind }) => kind === 'quizQuestionStats',
    );
    expect(quizCounts).toHaveLength(5);
    expect(amount(result, questionSk('q1'), 'attempts')).toBe(1);
    expect(amount(result, questionSk('q1'), 'misses')).toBe(0);
    expect(amount(result, questionSk('q2'), 'attempts')).toBe(1);
    expect(amount(result, questionSk('q2'), 'misses')).toBe(1);
    expect(amount(result, questionSk('q3'), 'misses')).toBe(1);
    expect(result.counts.every(({ courseId }) => courseId === 'c1')).toBe(true);
  });

  it('still makes the student active', () => {
    expect(contributions('quizAttempt', attempt()).members).toHaveLength(2);
  });

  it('counts a skipped question (no answer) as neither an attempt nor a miss', () => {
    const result = contributions(
      'quizAttempt',
      attempt({ answers: { q1: ['a'] }, correctQuestionIds: [] }),
    );
    expect(amount(result, questionSk('q1'), 'misses')).toBe(1);
    expect(amount(result, questionSk('q2'), 'attempts')).toBe(0);
  });

  it('gives no question counts for an attempt without answers or a quiz', () => {
    expect(
      contributions('quizAttempt', attempt({ answers: undefined })).counts,
    ).toEqual([]);
    expect(
      contributions('quizAttempt', attempt({ contentItemId: undefined }))
        .counts,
    ).toEqual([]);
  });

  it('is immutable: the same attempt seen as before and after adds nothing', () => {
    const image = attempt();
    expect(contributionsOfChange('quizAttempt', image, image).counts).toEqual(
      [],
    );
  });
});

describe('contributions of a quiz summary', () => {
  const band = (score: number) =>
    contributions('quizSummary', summary(score)).counts;

  it.each([
    [0, 'band0'],
    [9, 'band0'],
    [10, 'band1'],
    [55, 'band5'],
    [89, 'band8'],
    [90, 'band9'],
    [99, 'band9'],
    [100, 'band9'],
  ])('puts a best score of %i in %s', (score, attribute) => {
    expect(band(score)).toEqual([
      {
        kind: 'quizScoreStats',
        courseId: 'c1',
        sk: 'QUIZ#quiz1#SCORES',
        attribute,
        amount: 1,
      },
    ]);
  });

  it('gives nothing for a summary with no usable score', () => {
    expect(contributions('quizSummary', summary(undefined)).counts).toEqual([]);
    expect(contributions('quizSummary', summary('80')).counts).toEqual([]);
    expect(contributions('quizSummary', summary(-5)).counts).toEqual([]);
  });

  it('moves a student between bands once when their best rises', () => {
    const { counts } = contributionsOfChange(
      'quizSummary',
      summary(40),
      summary(85),
    );
    expect(counts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ attribute: 'band4', amount: -1 }),
        expect.objectContaining({ attribute: 'band8', amount: 1 }),
      ]),
    );
    expect(counts).toHaveLength(2);
  });

  it('moves nothing when the best rises within a band', () => {
    expect(
      contributionsOfChange('quizSummary', summary(41), summary(49)).counts,
    ).toEqual([]);
  });

  it('adds the student to a band when the summary is created', () => {
    expect(
      contributionsOfChange('quizSummary', undefined, summary(70)).counts,
    ).toEqual([expect.objectContaining({ attribute: 'band7', amount: 1 })]);
  });

  it('adds up in any order of deliveries', () => {
    const first = contributionsOfChange('quizSummary', undefined, summary(30));
    const second = contributionsOfChange(
      'quizSummary',
      summary(30),
      summary(75),
    );
    const forward = sumContributions([first, second]);
    const backward = sumContributions([second, first]);
    expect(aggregatesOf(forward)).toEqual(aggregatesOf(backward));
    expect(aggregatesOf(forward)[0].counters).toEqual({ band7: 1 });
  });
});

describe('aggregatesOf quiz contributions', () => {
  it('puts question counters and band counters on their own items', () => {
    const items = aggregatesOf(
      sumContributions([
        contributions('quizAttempt', attempt()),
        contributions('quizAttempt', attempt({ userId: 'u2' })),
        contributions('quizSummary', summary(80)),
      ]),
    );
    expect(items).toEqual(
      expect.arrayContaining([
        {
          kind: 'quizQuestionStats',
          courseId: 'c1',
          sk: questionSk('q2'),
          counters: { attempts: 2, misses: 2 },
        },
        {
          kind: 'quizScoreStats',
          courseId: 'c1',
          sk: 'QUIZ#quiz1#SCORES',
          counters: { band8: 1 },
        },
      ]),
    );
  });
});

describe('rebuildCourseAnalytics for quizzes', () => {
  it('writes question and score items from attempts and summaries', async () => {
    const { coreTable, puts } = fakeCoreTable({
      enrolments: [enrolment()],
      quizAttempts: [attempt(), attempt({ answers: { q1: ['a'] } })],
      quizSummaries: [summary(100)],
    });
    await rebuildCourseAnalytics(coreTable, 'c1');

    expect(puts.filter(({ kind }) => kind === 'quizQuestionStats')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          courseId: 'c1',
          contentItemId: 'quiz1',
          questionId: 'q1',
          attempts: 2,
        }),
        expect.objectContaining({
          contentItemId: 'quiz1',
          questionId: 'q2',
          attempts: 1,
          misses: 1,
        }),
      ]),
    );
    expect(puts.filter(({ kind }) => kind === 'quizScoreStats')).toEqual([
      expect.objectContaining({
        courseId: 'c1',
        contentItemId: 'quiz1',
        band9: 1,
      }),
    ]);
  });
});

const answer = (correct: boolean, answeredAt: string) => ({
  optionIds: ['a'],
  correct,
  answeredAt,
  quizVersion: 1,
});

const sheet = (answers: Record<string, unknown>) => ({
  courseId: 'c1',
  contentItemId: 'video1',
  userId: 'u1',
  answers,
  answerCount: Object.keys(answers).length,
});

const videoSk = (questionId: string) => `QUIZ#video1#Q#${questionId}`;

describe('contributions of a video answer sheet', () => {
  const two = {
    q1: answer(true, '2026-11-17T08:00:00.000Z'),
    q2: answer(false, '2026-11-18T08:00:00.000Z'),
  };

  it('counts an attempt on each entry and a miss on each incorrect one', () => {
    const result = contributions('videoAnswerSheet', sheet(two));

    expect(result.counts).toEqual([
      expect.objectContaining({
        kind: 'quizQuestionStats',
        sk: videoSk('q1'),
        attribute: 'attempts',
        amount: 1,
      }),
      expect.objectContaining({
        sk: videoSk('q2'),
        attribute: 'attempts',
        amount: 1,
      }),
      expect.objectContaining({
        sk: videoSk('q2'),
        attribute: 'misses',
        amount: 1,
      }),
    ]);
  });

  it('makes the learner active on the day and week of each entry', () => {
    const { members } = contributions('videoAnswerSheet', sheet(two));

    expect(members.map(({ period }) => period).sort()).toEqual([
      'DAY#2026-11-17',
      'DAY#2026-11-18',
      'WEEK#2026-W47',
    ]);
    expect(members.every(({ userId }) => userId === 'u1')).toBe(true);
  });

  it('adds only the new entry when a sheet goes from two entries to three', () => {
    const three = { ...two, q3: answer(false, '2026-11-18T09:00:00.000Z') };
    const change = contributionsOfChange(
      'videoAnswerSheet',
      sheet(two),
      sheet(three),
    );

    expect(change.counts).toEqual([
      expect.objectContaining({
        sk: videoSk('q3'),
        attribute: 'attempts',
        amount: 1,
      }),
      expect.objectContaining({
        sk: videoSk('q3'),
        attribute: 'misses',
        amount: 1,
      }),
    ]);
  });

  it('gives nothing for a malformed image', () => {
    for (const image of [
      { ...sheet(two), answers: 'nope' },
      { ...sheet(two), answers: [two.q1] },
      { ...sheet(two), contentItemId: undefined },
      { ...sheet({ q1: 'nope' }) },
    ]) {
      const result = contributions('videoAnswerSheet', image);
      expect(result.counts).toEqual([]);
    }
  });
});

describe('rebuildCourseAnalytics for video answer sheets', () => {
  it('adds each sheet entry to the question items', async () => {
    const { coreTable, puts } = fakeCoreTable({
      enrolments: [enrolment()],
      videoAnswerSheets: [
        sheet({
          q1: answer(true, '2026-11-17T08:00:00.000Z'),
          q2: answer(false, '2026-11-17T08:01:00.000Z'),
        }),
      ],
    });
    await rebuildCourseAnalytics(coreTable, 'c1');

    expect(puts.filter(({ kind }) => kind === 'quizQuestionStats')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contentItemId: 'video1',
          questionId: 'q1',
          attempts: 1,
        }),
        expect.objectContaining({
          contentItemId: 'video1',
          questionId: 'q2',
          attempts: 1,
          misses: 1,
        }),
      ]),
    );
  });
});
