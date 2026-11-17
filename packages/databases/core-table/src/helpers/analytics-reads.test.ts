/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { readCourseSummaries } from './analytics-reads.js';

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
