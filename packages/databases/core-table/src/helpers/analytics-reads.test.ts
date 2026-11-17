/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  readCourseAnalytics,
  readCourseSummaries,
  readLessonFunnel,
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
) => ({
  analytics: () => ({ go: async () => ({ data: { lessonStats } }) }),
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
        { periodKey: 'DAY#2026-11-17', enrolments: 2, activeLearners: 3 },
        { periodKey: 'DAY#2026-11-15', enrolments: 1, activeLearners: -1 },
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
      });
      expect(result.activeLearners).toBe(3);
    }
    const { daily } = await readCourseAnalytics(coreTable, 'c1', 30, NOW);
    expect(daily[0].date).toBe('2026-10-19');
    expect(daily.slice(-3)).toEqual([
      { date: '2026-11-15', enrolments: 1, activeLearners: 0 },
      { date: '2026-11-16', enrolments: 0, activeLearners: 0 },
      { date: '2026-11-17', enrolments: 2, activeLearners: 3 },
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
