/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  hasTransactionConflict,
  writeAtEnd,
  writeInActiveCourse,
  writeUnderActiveAncestors,
} from './course-lifecycle.js';

const ancestors = { courseId: 'c', moduleId: 'm', lessonId: 'l' };

// A coreTable whose transaction resolves as given. Only the transaction's
// shape matters here: `data` holds one result per item, ancestor checks first.
const coreTableWith = (
  result: {
    canceled: boolean;
    data?: { code?: string }[];
  },
  // `null` is a course that no longer exists.
  course: { courseId: string; status: string } | null = {
    courseId: 'c',
    status: 'published',
  },
) => {
  const check = () => ({ where: () => ({ commit: () => ({}) }) });
  const coreTable = {
    transaction: {
      write: vi.fn((build: (entities: unknown) => unknown) => {
        build({ course: { check }, module: { check }, lesson: { check } });
        return { go: vi.fn().mockResolvedValue(result) };
      }),
    },
    entities: {
      // Re-read to name an archived ancestor precisely: all still active.
      course: {
        get: () => ({ go: async () => ({ data: course ?? undefined }) }),
      },
      module: {
        get: () => ({ go: async () => ({ data: { moduleId: 'm' } }) }),
      },
      lesson: {
        get: () => ({ go: async () => ({ data: { lessonId: 'l' } }) }),
      },
    },
  };
  return coreTable as never;
};

const run = (
  result: Parameters<typeof coreTableWith>[0],
  onWrite?: () => never,
  course?: Parameters<typeof coreTableWith>[1],
) =>
  writeUnderActiveAncestors(
    coreTableWith(result, course),
    ancestors,
    () => [],
    onWrite,
  );

const CCF = { code: 'ConditionalCheckFailed' };
const TC = { code: 'TransactionConflict' };

// The transaction's results, in order: the course check, the module check, the
// lesson check, then the caller's writes.
describe('writeUnderActiveAncestors', () => {
  it('resolves when the transaction commits', async () => {
    await expect(run({ canceled: false, data: [] })).resolves.toBeUndefined();
  });

  it('reports CONFLICT when an ancestor check failed but nothing is archived any more', async () => {
    await expect(
      run({ canceled: true, data: [{}, CCF, {}, {}] }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  // An archived course is read-only. Its check is the first in the
  // transaction, and the precise error is found by re-reading.
  it('names the course when the course check failed because it is archived', async () => {
    await expect(
      run({ canceled: true, data: [CCF, {}, {}, {}] }, undefined, {
        courseId: 'c',
        status: 'archived',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the course first',
    });
  });

  it('reports NOT_FOUND when the course check failed because the course is gone', async () => {
    await expect(
      run({ canceled: true, data: [CCF, {}, {}, {}] }, undefined, null),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("calls the caller's own error when one of the writes failed its condition", async () => {
    const onWriteConflict = vi.fn(() => {
      throw new Error('caller error');
    });

    await expect(
      run({ canceled: true, data: [{}, {}, {}, CCF] }, onWriteConflict),
    ).rejects.toThrow('caller error');
  });

  // DynamoDB cancels one of two transactions that touch the same records at
  // once with TransactionConflict rather than a failed condition. Nothing was
  // written, so it's a retryable conflict, not a server error.
  it.each([[[TC, {}, {}, {}]], [[{}, {}, {}, TC]], [[TC, {}, {}, TC]]])(
    'reports CONFLICT, not a server error, for a transaction conflict %j',
    async (data) => {
      await expect(run({ canceled: true, data })).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('Please retry'),
      });
    },
  );

  it('still reports a failed condition in preference to a transaction conflict', async () => {
    const onWriteConflict = vi.fn(() => {
      throw new Error('caller error');
    });

    await expect(
      run({ canceled: true, data: [TC, {}, {}, CCF] }, onWriteConflict),
    ).rejects.toThrow('caller error');
  });

  it('reports INTERNAL_SERVER_ERROR when the cancellation has no recognised reason', async () => {
    await expect(
      run({ canceled: true, data: [{}, {}, {}, {}] }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });
});

const runInCourse = (
  result: Parameters<typeof coreTableWith>[0],
  onWrite?: () => never,
  course?: Parameters<typeof coreTableWith>[1],
) => writeInActiveCourse(coreTableWith(result, course), 'c', () => [], onWrite);

// A write that sits directly under the course: the course check is first, then
// the caller's writes.
describe('writeInActiveCourse', () => {
  it('resolves when the transaction commits', async () => {
    await expect(
      runInCourse({ canceled: false, data: [] }),
    ).resolves.toBeUndefined();
  });

  it('names the course when it is archived', async () => {
    await expect(
      runInCourse({ canceled: true, data: [CCF, {}] }, undefined, {
        courseId: 'c',
        status: 'archived',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the course first',
    });
  });

  it('reports NOT_FOUND when the course no longer exists', async () => {
    await expect(
      runInCourse({ canceled: true, data: [CCF, {}] }, undefined, null),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reports CONFLICT when the course check failed but the course is no longer archived', async () => {
    await expect(
      runInCourse({ canceled: true, data: [CCF, {}] }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it("calls the caller's own error when a write failed its condition", async () => {
    const onWriteConflict = vi.fn(() => {
      throw new Error('caller error');
    });

    await expect(
      runInCourse({ canceled: true, data: [{}, CCF] }, onWriteConflict),
    ).rejects.toThrow('caller error');
  });

  it.each([[[TC, {}]], [[{}, TC]]])(
    'reports CONFLICT, not a server error, for a transaction conflict %j',
    async (data) => {
      await expect(runInCourse({ canceled: true, data })).rejects.toMatchObject(
        {
          code: 'CONFLICT',
          message: expect.stringContaining('Please retry'),
        },
      );
    },
  );

  it('reports INTERNAL_SERVER_ERROR when the cancellation has no recognised reason', async () => {
    await expect(
      runInCourse({ canceled: true, data: [{}, {}] }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });
});

// A lesson holding items at `orders`, which last handed out `lastChildOrder`,
// and transactions that resolve as `results` says, one per try. Records what
// each try wrote: the lesson's claim and the item's order.
const lessonTable = ({
  lastChildOrder,
  orders = [],
  results,
}: {
  lastChildOrder?: number;
  orders?: number[];
  results: { canceled: boolean; data?: { code?: string }[] }[];
}) => {
  const tries: { claim: unknown; order: number }[] = [];
  const committed = (record: object) => ({ commit: () => record });
  const coreTable = {
    transaction: {
      write: vi.fn((build: (entities: unknown) => unknown[]) => {
        const check = () => ({ where: () => committed({}) });
        const items = build({
          course: { check },
          module: { check },
          lesson: {
            patch: () => ({
              set: (claim: unknown) => ({ where: () => committed({ claim }) }),
            }),
          },
        }) as { claim?: unknown; order?: number }[];
        tries.push({
          claim: items[2].claim,
          order: items[3].order as number,
        });
        return {
          go: vi.fn().mockResolvedValue(results[tries.length - 1]),
        };
      }),
    },
    entities: {
      course: {
        get: () => ({ go: async () => ({ data: { status: 'published' } }) }),
      },
      module: { get: () => ({ go: async () => ({ data: {} }) }) },
      lesson: {
        get: () => ({ go: async () => ({ data: { lastChildOrder } }) }),
      },
      contentItem: {
        query: {
          primary: () => ({
            go: async () => ({ data: orders.map((order) => ({ order })) }),
          }),
        },
      },
    },
  };
  return { coreTable: coreTable as never, tries };
};

const append = (coreTable: never) =>
  writeAtEnd(coreTable, ancestors, (_entities, order) => [{ order }] as never);

const COMMITTED = { canceled: false, data: [] };
// The lesson's claim (third, after the course and module) was taken.
const CLAIM_TAKEN = { canceled: true, data: [{}, {}, CCF, {}] };

// Invariant: siblings added or restored at once never share an `order` (#71).
describe('writeAtEnd', () => {
  it('appends after every sibling, archived ones included', async () => {
    const { coreTable, tries } = lessonTable({
      orders: [1, 7, 3],
      results: [COMMITTED],
    });

    await expect(append(coreTable)).resolves.toBe(8);
    expect(tries).toEqual([{ claim: { lastChildOrder: 8 }, order: 8 }]);
  });

  // An order handed out to a record since deleted isn't handed out again.
  it('appends after the last order the parent handed out', async () => {
    const { coreTable } = lessonTable({
      lastChildOrder: 12,
      orders: [1, 2],
      results: [COMMITTED],
    });

    await expect(append(coreTable)).resolves.toBe(13);
  });

  it('reads again and retries when another record claimed the order first', async () => {
    const { coreTable, tries } = lessonTable({
      results: [CLAIM_TAKEN, { canceled: true, data: [TC] }, COMMITTED],
    });

    await expect(append(coreTable)).resolves.toBe(1);
    expect(tries).toHaveLength(3);
  });

  it('gives up with CONFLICT after five tries', async () => {
    const { coreTable, tries } = lessonTable({
      results: Array(5).fill(CLAIM_TAKEN),
    });

    await expect(append(coreTable)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(tries).toHaveLength(5);
  });

  it("doesn't retry a write that failed its own condition", async () => {
    const { coreTable, tries } = lessonTable({
      results: [{ canceled: true, data: [{}, {}, {}, CCF] }],
    });

    await expect(append(coreTable)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(tries).toHaveLength(1);
  });
});

describe('hasTransactionConflict', () => {
  it('is true only when some result is a TransactionConflict', () => {
    expect(hasTransactionConflict([{}, TC])).toBe(true);
    expect(hasTransactionConflict([CCF])).toBe(false);
    expect(hasTransactionConflict(undefined)).toBe(false);
  });
});
