/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  readCourseAnalytics,
  readCourseQuizzes,
  readCourseSummaries,
  readCourseVideoQuestions,
  readLessonFunnel,
  readQuizAnalytics,
  readVideoQuestionAnalytics,
} from './analytics-reads.js';

type Keys = Record<string, string>[];

// Each entity's batch get answers from `stored`, keyed by the item's key.
const fakeCoreTable = (
  summaries: Record<string, unknown>[],
  weeks: Record<string, unknown>[],
  unprocessedOnce = false,
) => {
  const summaryGet = vi.fn();
  const weekGet = vi.fn();
  let first = true;
  summaryGet.mockImplementation((keys: Keys) => ({
    go: async () => {
      const drop = unprocessedOnce && first ? keys.slice(-1) : [];
      first = false;
      return {
        data: summaries.filter(
          (item) =>
            keys.some(({ courseId }) => courseId === item.courseId) &&
            !drop.some(({ courseId }) => courseId === item.courseId),
        ),
        unprocessed: drop,
      };
    },
  }));
  weekGet.mockImplementation((keys: Keys) => ({
    go: async () => ({
      data: weeks.filter((item) =>
        keys.some(
          ({ courseId, periodKey }) =>
            courseId === item.courseId && periodKey === item.periodKey,
        ),
      ),
      unprocessed: [],
    }),
  }));
  return {
    coreTable: {
      entities: {
        courseStats: { get: summaryGet },
        periodStats: { get: weekGet },
      },
    } as never,
    summaryGet,
    weekGet,
  };
};

// A Tuesday of ISO week 47 of 2026.
const NOW = new Date('2026-11-17T10:00:00.000Z');

describe('readCourseSummaries', () => {
  it('returns each course’s figures, with this week’s active learners', async () => {
    const { coreTable } = fakeCoreTable(
      [
        {
          courseId: 'c1',
          enrolments: 10,
          completed: 4,
          dropped: 1,
          activated: 7,
          promptAnswered: 3,
          promptDismissed: 2,
          updatedAt: '2026-11-17T09:00:00.000Z',
        },
      ],
      [
        { courseId: 'c1', periodKey: 'WEEK#2026-W47', activeLearners: 6 },
        // Last week's item is not this week's.
        { courseId: 'c1', periodKey: 'WEEK#2026-W46', activeLearners: 9 },
      ],
    );

    expect(await readCourseSummaries(coreTable, ['c1'], NOW)).toEqual([
      {
        courseId: 'c1',
        enrolments: 10,
        completed: 4,
        dropped: 1,
        activated: 7,
        promptAnswered: 3,
        promptDismissed: 2,
        activeLearners: 6,
        updatedAt: '2026-11-17T09:00:00.000Z',
      },
    ]);
  });

  it('reads with one batch get per kind, however many courses', async () => {
    const { coreTable, summaryGet, weekGet } = fakeCoreTable([], []);
    const ids = Array.from({ length: 30 }, (_, i) => `c${i}`);

    await readCourseSummaries(coreTable, ids, NOW);

    expect(summaryGet).toHaveBeenCalledTimes(1);
    expect(summaryGet.mock.calls[0][0]).toHaveLength(30);
    expect(weekGet).toHaveBeenCalledTimes(1);
    expect(weekGet.mock.calls[0][0]).toEqual(
      ids.map((courseId) => ({ courseId, periodKey: 'WEEK#2026-W47' })),
    );
  });

  it('splits more courses than a batch get takes', async () => {
    const { coreTable, summaryGet } = fakeCoreTable([], []);
    const ids = Array.from({ length: 150 }, (_, i) => `c${i}`);

    await readCourseSummaries(coreTable, ids, NOW);

    expect(summaryGet.mock.calls.map(([keys]) => keys.length)).toEqual([
      100, 50,
    ]);
  });

  it('gives zeros and no update time for a course without items', async () => {
    const { coreTable } = fakeCoreTable([], []);

    expect(await readCourseSummaries(coreTable, ['new'], NOW)).toEqual([
      {
        courseId: 'new',
        enrolments: 0,
        completed: 0,
        dropped: 0,
        activated: 0,
        promptAnswered: 0,
        promptDismissed: 0,
        activeLearners: 0,
        updatedAt: null,
      },
    ]);
  });

  it('keeps the order of the courses asked for', async () => {
    const { coreTable } = fakeCoreTable(
      [
        { courseId: 'a', enrolments: 1 },
        { courseId: 'b', enrolments: 2 },
      ],
      [],
    );

    const result = await readCourseSummaries(coreTable, ['b', 'x', 'a'], NOW);

    expect(
      result.map(({ courseId, enrolments }) => [courseId, enrolments]),
    ).toEqual([
      ['b', 2],
      ['x', 0],
      ['a', 1],
    ]);
  });

  it('clamps a counter below zero to 0', async () => {
    const { coreTable } = fakeCoreTable(
      [{ courseId: 'c1', enrolments: -1, completed: -2, dropped: 3 }],
      [{ courseId: 'c1', periodKey: 'WEEK#2026-W47', activeLearners: -1 }],
    );

    const [summary] = await readCourseSummaries(coreTable, ['c1'], NOW);

    expect(summary).toMatchObject({
      enrolments: 0,
      completed: 0,
      dropped: 3,
      activeLearners: 0,
    });
  });

  it('clamps the activation and prompt counters, and activated to enrolments', async () => {
    const { coreTable } = fakeCoreTable(
      [
        {
          courseId: 'a',
          enrolments: 3,
          activated: 5,
          promptAnswered: -1,
          promptDismissed: -4,
        },
        { courseId: 'b', enrolments: 3, activated: -2 },
      ],
      [],
    );

    const [a, b] = await readCourseSummaries(coreTable, ['a', 'b'], NOW);

    expect(a).toMatchObject({
      activated: 3,
      promptAnswered: 0,
      promptDismissed: 0,
    });
    expect(b.activated).toBe(0);
  });

  it('asks again for what DynamoDB left unprocessed', async () => {
    const { coreTable, summaryGet } = fakeCoreTable(
      [
        { courseId: 'a', enrolments: 1 },
        { courseId: 'b', enrolments: 2 },
      ],
      [],
      true,
    );

    const result = await readCourseSummaries(coreTable, ['a', 'b'], NOW);

    expect(result.map(({ enrolments }) => enrolments)).toEqual([1, 2]);
    expect(summaryGet).toHaveBeenCalledTimes(2);
    expect(summaryGet.mock.calls[1][0]).toEqual([{ courseId: 'b' }]);
  });

  it('reads nothing for no courses', async () => {
    const { coreTable, summaryGet } = fakeCoreTable([], []);

    expect(await readCourseSummaries(coreTable, [], NOW)).toEqual([]);
    expect(summaryGet).not.toHaveBeenCalled();
  });
});

// The analytics and curriculum collections, answering with the given items.
const collectionsOf = (
  lessonStats: Record<string, unknown>[] = [],
  curriculum: Record<string, Record<string, unknown>[]> = {},
  quiz: {
    quizQuestionStats?: Record<string, unknown>[];
    quizScoreStats?: Record<string, unknown>[];
  } = {},
) => ({
  analytics: () => ({
    go: async () => ({
      data: {
        lessonStats,
        quizQuestionStats: [],
        quizScoreStats: [],
        ...quiz,
      },
    }),
  }),
  curriculum: () => ({
    go: async () => ({
      data: { module: [], lesson: [], contentItem: [], ...curriculum },
    }),
  }),
});

const shown = { visibility: 'visible' };

describe('readLessonFunnel', () => {
  const module = (moduleId: string, order: number, extra = {}) => ({
    moduleId,
    order,
    title: moduleId,
    ...shown,
    ...extra,
  });
  const lesson = (
    lessonId: string,
    moduleId: string,
    order: number,
    extra = {},
  ) => ({ lessonId, moduleId, order, title: lessonId, ...shown, ...extra });
  const table = (
    lessonStats: Record<string, unknown>[],
    curriculum: Record<string, Record<string, unknown>[]>,
  ) => ({ collections: collectionsOf(lessonStats, curriculum) }) as never;

  it('lists shown lessons in course order with started and share', async () => {
    const result = await readLessonFunnel(
      table(
        [
          { lessonId: 'a2', inProgress: 1, completed: 1 },
          { lessonId: 'b1', inProgress: 0, completed: 3 },
        ],
        {
          module: [module('m2', 2), module('m1', 1)],
          lesson: [
            lesson('b1', 'm2', 1),
            lesson('a2', 'm1', 2),
            lesson('a1', 'm1', 1),
          ],
        },
      ),
      'c1',
    );

    expect(result.map(({ lessonId }) => lessonId)).toEqual(['a1', 'a2', 'b1']);
    expect(result[1]).toMatchObject({
      started: 2,
      completed: 1,
      completionShare: 50,
    });
    expect(result[2]).toMatchObject({ started: 3, completionShare: 100 });
  });

  it('shows zeros and no share for a lesson without stats', async () => {
    const [only] = await readLessonFunnel(
      table([], { module: [module('m1', 1)], lesson: [lesson('a1', 'm1', 1)] }),
      'c1',
    );
    expect(only).toMatchObject({
      inProgress: 0,
      completed: 0,
      started: 0,
      completionShare: null,
    });
  });

  it('leaves out hidden and archived lessons and those in hidden or archived modules', async () => {
    const result = await readLessonFunnel(
      table([{ lessonId: 'hid', inProgress: 2, completed: 2 }], {
        module: [
          module('m1', 1),
          module('mh', 2, { visibility: 'hidden' }),
          module('ma', 3, { archivedAt: '2026-11-01T00:00:00Z' }),
        ],
        lesson: [
          lesson('ok', 'm1', 1),
          lesson('hid', 'm1', 2, { visibility: 'hidden' }),
          lesson('arc', 'm1', 3, { archivedAt: '2026-11-01T00:00:00Z' }),
          lesson('inh', 'mh', 1),
          lesson('ina', 'ma', 1),
        ],
      }),
      'c1',
    );
    expect(result.map(({ lessonId }) => lessonId)).toEqual(['ok']);
  });

  it('gives a hidden lesson its stored counts back when shown again', async () => {
    const stats = [{ lessonId: 'a1', inProgress: 1, completed: 2 }];
    const curriculum = (extra = {}) => ({
      module: [module('m1', 1)],
      lesson: [lesson('a1', 'm1', 1, extra)],
    });
    expect(
      await readLessonFunnel(
        table(stats, curriculum({ visibility: 'hidden' })),
        'c1',
      ),
    ).toEqual([]);
    expect(
      (await readLessonFunnel(table(stats, curriculum()), 'c1'))[0],
    ).toMatchObject({ started: 3, completed: 2 });
  });

  it('never shows a negative count', async () => {
    const [only] = await readLessonFunnel(
      table([{ lessonId: 'a1', inProgress: -1, completed: 1 }], {
        module: [module('m1', 1)],
        lesson: [lesson('a1', 'm1', 1)],
      }),
      'c1',
    );
    expect(only).toMatchObject({ inProgress: 0, started: 1 });
  });
});

describe('readCourseAnalytics', () => {
  // Answers the summary and week batch gets from `summary`/`week`, and the
  // day range query from `days`, recording the range asked for.
  const fakeTable = (
    summary: Record<string, unknown> | null,
    days: Record<string, unknown>[],
    week: Record<string, unknown> | null = null,
  ) => {
    const between = vi.fn();
    const go = vi.fn(async () => ({ data: days }));
    between.mockReturnValue({ go });
    const coreTable = {
      collections: collectionsOf(),
      entities: {
        courseStats: {
          get: () => ({
            go: async () => ({
              data: summary ? [{ courseId: 'c1', ...summary }] : [],
              unprocessed: [],
            }),
          }),
        },
        periodStats: {
          get: () => ({
            go: async () => ({
              data: week ? [{ courseId: 'c1', ...week }] : [],
              unprocessed: [],
            }),
          }),
          query: { primary: vi.fn(() => ({ between })) },
        },
      },
    } as never;
    return { coreTable, between, go };
  };

  it('derives active from the totals, never below 0', async () => {
    const { coreTable } = fakeTable(
      { enrolments: 10, completed: 4, dropped: 1 },
      [],
    );
    expect((await readCourseAnalytics(coreTable, 'c1', 30, NOW)).active).toBe(
      5,
    );

    const skewed = fakeTable({ enrolments: 2, completed: 2, dropped: 1 }, []);
    expect(
      (await readCourseAnalytics(skewed.coreTable, 'c1', 30, NOW)).active,
    ).toBe(0);
  });

  it('gives exactly `days` entries, oldest first, zero filled', async () => {
    const { coreTable } = fakeTable(
      { enrolments: 3 },
      [
        {
          periodKey: 'DAY#2026-11-17',
          enrolments: 2,
          activeLearners: 3,
          activated: 1,
        },
        {
          periodKey: 'DAY#2026-11-15',
          enrolments: 1,
          activeLearners: -1,
          activated: 4,
        },
      ],
      { periodKey: 'WEEK#2026-W47', activeLearners: 3 },
    );

    for (const days of [30, 90]) {
      const result = await readCourseAnalytics(coreTable, 'c1', days, NOW);
      expect(result.daily).toHaveLength(days);
      expect(result.daily.at(-1)).toEqual({
        date: '2026-11-17',
        enrolments: 2,
        activeLearners: 3,
        activated: 1,
      });
      expect(result.activeLearners).toBe(3);
    }
    const { daily } = await readCourseAnalytics(coreTable, 'c1', 30, NOW);
    expect(daily[0].date).toBe('2026-10-19');
    expect(daily.slice(-3)).toEqual([
      // activated is never above that day's enrolments
      { date: '2026-11-15', enrolments: 1, activeLearners: 0, activated: 1 },
      { date: '2026-11-16', enrolments: 0, activeLearners: 0, activated: 0 },
      { date: '2026-11-17', enrolments: 2, activeLearners: 3, activated: 1 },
    ]);
  });

  it('reads the day items with one range query over the window', async () => {
    const { coreTable, between } = fakeTable(null, []);

    const result = await readCourseAnalytics(coreTable, 'c1', 90, NOW);

    expect(between).toHaveBeenCalledTimes(1);
    expect(between).toHaveBeenCalledWith(
      { periodKey: 'DAY#2026-08-20' },
      { periodKey: 'DAY#2026-11-17' },
    );
    expect(result.updatedAt).toBeNull();
    expect(result.enrolments).toBe(0);
  });
});

describe('quiz analytics', () => {
  const module = (moduleId: string, order: number, extra = {}) => ({
    moduleId,
    order,
    title: moduleId,
    ...shown,
    ...extra,
  });
  const lesson = (lessonId: string, moduleId: string, order: number) => ({
    lessonId,
    moduleId,
    order,
    title: lessonId,
    ...shown,
  });
  const prompt = (words: string) =>
    JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: words }] },
      ],
    });
  const question = (questionId: string, words = `Question ${questionId}`) => ({
    questionId,
    kind: 'single',
    prompt: prompt(words),
    options: [],
  });
  const quizItem = (
    contentItemId: string,
    lessonId: string,
    extra: Record<string, unknown> = {},
  ) => ({
    contentItemId,
    lessonId,
    moduleId: 'm1',
    type: 'quiz',
    title: `Quiz ${contentItemId}`,
    order: 1,
    questions: [question('q1'), question('q2'), question('q3')],
    ...shown,
    ...extra,
  });
  const qStats = (
    contentItemId: string,
    questionId: string,
    attempts: number,
    misses: number,
  ) => ({ contentItemId, questionId, attempts, misses });
  const table = (
    curriculum: Record<string, Record<string, unknown>[]>,
    quiz: Parameters<typeof collectionsOf>[2] = {},
  ) =>
    ({
      collections: collectionsOf(
        [],
        {
          module: [module('m1', 1)],
          lesson: [lesson('l1', 'm1', 1)],
          ...curriculum,
        },
        quiz,
      ),
    }) as never;

  describe('readQuizAnalytics', () => {
    it('ranks questions with 5 or more attempts by miss rate, then attempts, then the rest in quiz order', async () => {
      const result = await readQuizAnalytics(
        table(
          {
            contentItem: [
              quizItem('z1', 'l1', {
                questions: [
                  question('q1'),
                  question('q2'),
                  question('q3'),
                  question('q4'),
                  question('q5'),
                ],
              }),
            ],
          },
          {
            quizQuestionStats: [
              qStats('z1', 'q1', 10, 5), // 50%
              qStats('z1', 'q2', 20, 10), // 50%, more attempts
              qStats('z1', 'q3', 5, 5), // 100%
              qStats('z1', 'q4', 4, 4), // unranked
              // q5 has no item: unranked, zeros
            ],
          },
        ),
        'c1',
        'z1',
      );

      expect(result?.questions.map(({ questionId }) => questionId)).toEqual([
        'q3',
        'q2',
        'q1',
        'q4',
        'q5',
      ]);
      expect(result?.questions.map(({ ranked }) => ranked)).toEqual([
        true,
        true,
        true,
        false,
        false,
      ]);
      expect(result?.questions[0]).toEqual({
        questionId: 'q3',
        text: 'Question q3',
        attempts: 5,
        misses: 5,
        missRate: 100,
        ranked: true,
      });
      expect(result?.questions[4]).toMatchObject({
        attempts: 0,
        misses: 0,
        missRate: null,
        ranked: false,
      });
    });

    it('lists only the quiz’s current questions, dropping a deleted one’s stats', async () => {
      const result = await readQuizAnalytics(
        table(
          {
            contentItem: [
              quizItem('z1', 'l1', { questions: [question('q1')] }),
            ],
          },
          {
            quizQuestionStats: [
              qStats('z1', 'q1', 6, 3),
              qStats('z1', 'gone', 9, 9),
            ],
          },
        ),
        'c1',
        'z1',
      );
      expect(result?.questions.map(({ questionId }) => questionId)).toEqual([
        'q1',
      ]);
    });

    it('does not mix in another quiz’s stats', async () => {
      const result = await readQuizAnalytics(
        table(
          { contentItem: [quizItem('z1', 'l1'), quizItem('z2', 'l1')] },
          { quizQuestionStats: [qStats('z2', 'q1', 9, 9)] },
        ),
        'c1',
        'z1',
      );
      expect(result?.questions[0]).toMatchObject({ attempts: 0 });
    });

    it('gives ten score bands whose sum is the number of students', async () => {
      const result = await readQuizAnalytics(
        table(
          { contentItem: [quizItem('z1', 'l1')] },
          {
            quizScoreStats: [
              { contentItemId: 'z1', band0: 1, band4: 2, band9: 3, band5: -1 },
            ],
          },
        ),
        'c1',
        'z1',
      );
      expect(result?.scoreBands).toHaveLength(10);
      expect(result?.scoreBands.map(({ from, to }) => [from, to])).toEqual([
        [0, 9],
        [10, 19],
        [20, 29],
        [30, 39],
        [40, 49],
        [50, 59],
        [60, 69],
        [70, 79],
        [80, 89],
        [90, 100],
      ]);
      expect(result?.scoreBands.map(({ students }) => students)).toEqual([
        1, 0, 0, 0, 2, 0, 0, 0, 0, 3,
      ]);
      expect(result?.students).toBe(6);
    });

    it('shows zeros for a quiz nobody has attempted', async () => {
      const result = await readQuizAnalytics(
        table({ contentItem: [quizItem('z1', 'l1')] }),
        'c1',
        'z1',
      );
      expect(result?.students).toBe(0);
      expect(result?.scoreBands.every(({ students }) => students === 0)).toBe(
        true,
      );
    });

    it('answers undefined for an unknown quiz, a non-quiz item or a hidden quiz', async () => {
      const curriculum = {
        contentItem: [
          quizItem('hidden', 'l1', { visibility: 'hidden' }),
          { ...quizItem('video', 'l1'), type: 'video' },
        ],
      };
      for (const id of ['nope', 'video', 'hidden']) {
        expect(
          await readQuizAnalytics(table(curriculum), 'c1', id),
        ).toBeUndefined();
      }
    });
  });

  describe('readCourseQuizzes', () => {
    it('lists the shown quizzes in course order with their student count', async () => {
      const result = await readCourseQuizzes(
        table(
          {
            module: [module('m1', 1), module('m2', 2)],
            lesson: [lesson('l2', 'm2', 1), lesson('l1', 'm1', 1)],
            contentItem: [
              quizItem('b', 'l2'),
              quizItem('a2', 'l1', { order: 2 }),
              quizItem('a1', 'l1', { order: 1 }),
              { ...quizItem('v', 'l1'), type: 'video' },
              quizItem('hidden', 'l1', { visibility: 'hidden' }),
            ],
          },
          {
            quizScoreStats: [
              { contentItemId: 'a1', band3: 2, band8: 1 },
              { contentItemId: 'hidden', band0: 4 },
            ],
          },
        ),
        'c1',
      );
      expect(result).toEqual([
        { contentItemId: 'a1', lessonId: 'l1', title: 'Quiz a1', students: 3 },
        { contentItemId: 'a2', lessonId: 'l1', title: 'Quiz a2', students: 0 },
        { contentItemId: 'b', lessonId: 'l2', title: 'Quiz b', students: 0 },
      ]);
    });

    it('drops a quiz in a hidden lesson', async () => {
      const result = await readCourseQuizzes(
        table({
          lesson: [{ ...lesson('l1', 'm1', 1), visibility: 'hidden' }],
          contentItem: [quizItem('a', 'l1')],
        }),
        'c1',
      );
      expect(result).toEqual([]);
    });

    it('is part of readCourseAnalytics', async () => {
      const coreTable = {
        ...(table({ contentItem: [quizItem('a', 'l1')] }) as object),
        entities: {
          courseStats: {
            get: () => ({ go: async () => ({ data: [], unprocessed: [] }) }),
          },
          periodStats: {
            get: () => ({ go: async () => ({ data: [], unprocessed: [] }) }),
            query: {
              primary: () => ({
                between: () => ({ go: async () => ({ data: [] }) }),
              }),
            },
          },
        },
      } as never;
      const result = await readCourseAnalytics(coreTable, 'c1', 30, NOW);
      expect(result.quizzes).toEqual([
        { contentItemId: 'a', lessonId: 'l1', title: 'Quiz a', students: 0 },
      ]);
    });
  });
});

describe('video question analytics', () => {
  const module = (moduleId: string, order: number, extra = {}) => ({
    moduleId,
    order,
    title: moduleId,
    ...shown,
    ...extra,
  });
  const lesson = (lessonId: string, moduleId: string, order: number) => ({
    lessonId,
    moduleId,
    order,
    title: lessonId,
    ...shown,
  });
  const question = (
    questionId: string,
    atSeconds: number | null = 30,
    words = `Question ${questionId}`,
  ) => ({
    questionId,
    kind: 'single',
    atSeconds,
    prompt: JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: words }] },
      ],
    }),
    options: [],
  });
  const video = (
    contentItemId: string,
    lessonId: string,
    extra: Record<string, unknown> = {},
  ) => ({
    contentItemId,
    lessonId,
    moduleId: 'm1',
    type: 'video',
    title: `Video ${contentItemId}`,
    order: 1,
    questions: [question('q1')],
    ...shown,
    ...extra,
  });
  const qStats = (
    contentItemId: string,
    questionId: string,
    attempts: number,
    misses: number,
  ) => ({ contentItemId, questionId, attempts, misses });
  const table = (
    curriculum: Record<string, Record<string, unknown>[]>,
    stats: Record<string, unknown>[] = [],
  ) =>
    ({
      collections: collectionsOf(
        [],
        {
          module: [module('m1', 1)],
          lesson: [lesson('l1', 'm1', 1)],
          ...curriculum,
        },
        { quizQuestionStats: stats },
      ),
    }) as never;

  describe('readCourseVideoQuestions', () => {
    it('lists shown videos with questions in course order', async () => {
      const result = await readCourseVideoQuestions(
        table({
          module: [module('m1', 1), module('m2', 2)],
          lesson: [lesson('l2', 'm2', 1), lesson('l1', 'm1', 1)],
          contentItem: [
            video('b', 'l2'),
            video('a2', 'l1', {
              order: 2,
              questions: [question('q1'), question('q2')],
            }),
            video('a1', 'l1', { order: 1 }),
          ],
        }),
        'c1',
      );
      expect(result).toEqual([
        {
          contentItemId: 'a1',
          lessonId: 'l1',
          title: 'Video a1',
          questions: 1,
        },
        {
          contentItemId: 'a2',
          lessonId: 'l1',
          title: 'Video a2',
          questions: 2,
        },
        { contentItemId: 'b', lessonId: 'l2', title: 'Video b', questions: 1 },
      ]);
    });

    it('leaves out hidden and archived videos, lessons and modules', async () => {
      const result = await readCourseVideoQuestions(
        table({
          module: [
            module('m1', 1),
            module('m2', 2, { visibility: 'hidden' }),
            module('m3', 3, { archivedAt: '2026-01-01T00:00:00.000Z' }),
          ],
          lesson: [
            lesson('l1', 'm1', 1),
            { ...lesson('l2', 'm1', 2), visibility: 'hidden' },
            lesson('l3', 'm2', 1),
            lesson('l4', 'm3', 1),
          ],
          contentItem: [
            video('shown', 'l1'),
            video('hiddenVideo', 'l1', { visibility: 'hidden' }),
            video('archivedVideo', 'l1', {
              archivedAt: '2026-01-01T00:00:00.000Z',
            }),
            video('inHiddenLesson', 'l2'),
            video('inHiddenModule', 'l3'),
            video('inArchivedModule', 'l4'),
          ],
        }),
        'c1',
      );
      expect(result.map(({ contentItemId }) => contentItemId)).toEqual([
        'shown',
      ]);
    });

    it('leaves out videos without questions and items that are not videos', async () => {
      const result = await readCourseVideoQuestions(
        table({
          contentItem: [
            video('none', 'l1', { questions: undefined }),
            video('empty', 'l1', { questions: [] }),
            video('quiz', 'l1', { type: 'quiz' }),
            video('ok', 'l1'),
          ],
        }),
        'c1',
      );
      expect(result.map(({ contentItemId }) => contentItemId)).toEqual(['ok']);
    });

    it('is part of readCourseAnalytics', async () => {
      const coreTable = {
        ...(table({ contentItem: [video('a', 'l1')] }) as object),
        entities: {
          courseStats: {
            get: () => ({ go: async () => ({ data: [], unprocessed: [] }) }),
          },
          periodStats: {
            get: () => ({ go: async () => ({ data: [], unprocessed: [] }) }),
            query: {
              primary: () => ({
                between: () => ({ go: async () => ({ data: [] }) }),
              }),
            },
          },
        },
      } as never;
      const result = await readCourseAnalytics(coreTable, 'c1', 30, NOW);
      expect(result.videoQuestions).toEqual([
        { contentItemId: 'a', lessonId: 'l1', title: 'Video a', questions: 1 },
      ]);
    });
  });

  describe('readVideoQuestionAnalytics', () => {
    it('ranks questions with 5 or more answers, then the rest in asking order', async () => {
      const result = await readVideoQuestionAnalytics(
        table(
          {
            contentItem: [
              video('v1', 'l1', {
                questions: [
                  question('q1', 10),
                  question('q2', 20),
                  question('q3', 30),
                  question('q4', null),
                  question('q5', null),
                ],
              }),
            ],
          },
          [
            qStats('v1', 'q1', 4, 4), // 4 answers: unranked
            qStats('v1', 'q2', 5, 1), // exactly 5: ranked, 20%
            qStats('v1', 'q3', 12, 6), // more than 5: ranked, 50%
            qStats('v1', 'q4', 0, 0),
            qStats('other', 'q5', 9, 9), // another item's stats
          ],
        ),
        'c1',
        'v1',
      );
      expect(result?.questions.map(({ questionId }) => questionId)).toEqual([
        'q3',
        'q2',
        'q1',
        'q4',
        'q5',
      ]);
      expect(result?.questions[0]).toEqual({
        questionId: 'q3',
        text: 'Question q3',
        atSeconds: 30,
        attempts: 12,
        misses: 6,
        missRate: 50,
        ranked: true,
      });
      expect(result?.questions[2]).toMatchObject({
        questionId: 'q1',
        atSeconds: 10,
        missRate: 100,
        ranked: false,
      });
      expect(result?.questions[3]).toMatchObject({
        atSeconds: null,
        attempts: 0,
        missRate: null,
      });
    });

    it('drops stats of a removed question and shows a new one at zero', async () => {
      const result = await readVideoQuestionAnalytics(
        table(
          {
            contentItem: [video('v1', 'l1', { questions: [question('new')] })],
          },
          [qStats('v1', 'removed', 8, 8)],
        ),
        'c1',
        'v1',
      );
      expect(result?.questions).toEqual([
        {
          questionId: 'new',
          text: 'Question new',
          atSeconds: 30,
          attempts: 0,
          misses: 0,
          missRate: null,
          ranked: false,
        },
      ]);
    });

    it('is undefined for a hidden video, one without questions, a quiz and an unknown id', async () => {
      const coreTable = table({
        contentItem: [
          video('hidden', 'l1', { visibility: 'hidden' }),
          video('empty', 'l1', { questions: [] }),
          video('quiz', 'l1', { type: 'quiz' }),
        ],
      });
      for (const id of ['hidden', 'empty', 'quiz', 'missing']) {
        expect(await readVideoQuestionAnalytics(coreTable, 'c1', id)).toBe(
          undefined,
        );
      }
    });
  });
});

describe('modulesWithoutQuestions', () => {
  const module = (moduleId: string, order: number, extra = {}) => ({
    moduleId,
    order,
    title: `Module ${moduleId}`,
    ...shown,
    ...extra,
  });
  const lesson = (lessonId: string, moduleId: string) => ({
    lessonId,
    moduleId,
    order: 1,
    title: lessonId,
    ...shown,
  });
  const item = (
    contentItemId: string,
    lessonId: string,
    type: string,
    extra: Record<string, unknown> = {},
  ) => ({
    contentItemId,
    lessonId,
    type,
    title: contentItemId,
    order: 1,
    ...shown,
    ...extra,
  });
  const withQuestions = { questions: [{ questionId: 'q1' }] };

  const read = async (
    curriculum: Record<string, Record<string, unknown>[]>,
  ) => {
    const none = { go: async () => ({ data: [], unprocessed: [] }) };
    const coreTable = {
      collections: collectionsOf([], curriculum),
      entities: {
        courseStats: { get: () => none },
        periodStats: {
          get: () => none,
          query: { primary: () => ({ between: () => none }) },
        },
      },
    } as never;
    return (await readCourseAnalytics(coreTable, 'c1', 1, NOW))
      .modulesWithoutQuestions;
  };
  const one = (
    items: Record<string, unknown>[],
    extra: {
      module?: Record<string, unknown>;
      lesson?: Record<string, unknown>;
    } = {},
  ) =>
    read({
      module: [{ ...module('m1', 1), ...extra.module }],
      lesson: [{ ...lesson('l1', 'm1'), ...extra.lesson }],
      contentItem: items,
    });

  it('lists a module with only a video, in course order', async () => {
    expect(
      await read({
        module: [module('m2', 2), module('m1', 1)],
        lesson: [lesson('l1', 'm1'), lesson('l2', 'm2')],
        contentItem: [item('v2', 'l2', 'video'), item('v1', 'l1', 'video')],
      }),
    ).toEqual([
      { moduleId: 'm1', title: 'Module m1' },
      { moduleId: 'm2', title: 'Module m2' },
    ]);
  });

  it('leaves out a module with a video and a quiz', async () => {
    expect(
      await one([item('v', 'l1', 'video'), item('q', 'l1', 'quiz')]),
    ).toEqual([]);
  });

  it('leaves out a module whose video has questions', async () => {
    expect(await one([item('v', 'l1', 'video', withQuestions)])).toEqual([]);
  });

  it('counts a video with an empty question list as without questions', async () => {
    expect(
      await one([item('v', 'l1', 'video', { questions: [] })]),
    ).toHaveLength(1);
  });

  it('leaves out a module with no video', async () => {
    expect(await one([item('t', 'l1', 'text')])).toEqual([]);
  });

  it('leaves out a module whose only video is hidden', async () => {
    expect(
      await one([item('v', 'l1', 'video', { visibility: 'hidden' })]),
    ).toEqual([]);
  });

  it('still lists a module when its quiz is hidden', async () => {
    expect(
      await one([
        item('v', 'l1', 'video'),
        item('q', 'l1', 'quiz', { visibility: 'hidden' }),
      ]),
    ).toHaveLength(1);
  });

  it('leaves out an archived module', async () => {
    expect(
      await one([item('v', 'l1', 'video')], {
        module: { archivedAt: '2026-11-01T00:00:00.000Z' },
      }),
    ).toEqual([]);
  });
});
