/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { writeAtEnd } from './order.js';

const ancestors = { courseId: 'c', moduleId: 'm', lessonId: 'l' };

const CCF = { code: 'ConditionalCheckFailed' };
const TC = { code: 'TransactionConflict' };

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
