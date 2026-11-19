/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCoreTableService } from '../service.js';
import type { Delta, Member } from './analytics.js';
import { applyAnalyticsChange } from './analytics-writes.js';

// ElectroDB builds the requests for real; a small in-memory table applies
// them, honouring a Put's `attribute_not_exists` and an Update's ADD, so what
// the transactions would leave in DynamoDB can be read back.

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
let coreTable: CoreTable;
let realWrite: CoreTable['transaction']['write'];
beforeAll(async () => {
  coreTable = await createCoreTableService();
  realWrite = coreTable.transaction.write.bind(coreTable.transaction);
});
afterEach(() => {
  vi.restoreAllMocks();
});

interface TransactItem {
  Put?: { Item: Record<string, unknown>; ConditionExpression?: string };
  Update?: {
    Key: { pk: string; sk: string };
    UpdateExpression: string;
    ExpressionAttributeNames: Record<string, string>;
    ExpressionAttributeValues: Record<string, unknown>;
  };
}

const memoryTable = (failOn?: (items: TransactItem[]) => boolean) => {
  const items = new Map<string, Record<string, unknown>>();
  const transactions: TransactItem[][] = [];
  const key = (pk: unknown, sk: unknown) => `${pk}|${sk}`;
  const write = vi.spyOn(coreTable.transaction, 'write').mockImplementation(((
    callback: never,
  ) => {
    const built = realWrite(callback);
    return {
      params: built.params,
      go: async () => {
        const { TransactItems } = built.params() as {
          TransactItems: TransactItem[];
        };
        transactions.push(TransactItems);
        if (failOn?.(TransactItems)) {
          throw new Error('ProvisionedThroughputExceeded');
        }
        const reasons = TransactItems.map((item) =>
          item.Put?.ConditionExpression &&
          items.has(key(item.Put.Item.pk, item.Put.Item.sk))
            ? { code: 'ConditionalCheckFailed' }
            : { code: 'None' },
        );
        if (reasons.some(({ code }) => code !== 'None')) {
          return { canceled: true, data: reasons };
        }
        for (const { Put, Update } of TransactItems) {
          if (Put) {
            items.set(key(Put.Item.pk, Put.Item.sk), { ...Put.Item });
          }
          if (Update) {
            const stored = items.get(key(Update.Key.pk, Update.Key.sk)) ?? {};
            const add = /ADD (.*)$/.exec(Update.UpdateExpression)?.[1] ?? '';
            for (const part of add.split(', ')) {
              const [name, value] = part.split(' ');
              const attribute = Update.ExpressionAttributeNames[name];
              stored[attribute] =
                Number(stored[attribute] ?? 0) +
                Number(Update.ExpressionAttributeValues[value]);
            }
            items.set(key(Update.Key.pk, Update.Key.sk), stored);
          }
        }
        return { canceled: false, data: [] };
      },
    };
  }) as never);
  return { items, transactions, write };
};

const NOW = new Date('2026-11-17T10:00:00.000Z');
const count = (sk: string, attribute: string, amount = 1): Delta => ({
  kind: sk === 'SUMMARY' ? 'courseStats' : 'periodStats',
  courseId: 'c1',
  sk,
  attribute,
  amount,
});
const member = (period: string, userId = 'u1'): Member => ({
  courseId: 'c1',
  period,
  userId,
});
const change = (overrides: object = {}) => ({
  eventId: 'e1',
  courseId: 'c1',
  counts: [
    count('SUMMARY', 'enrolments'),
    count('DAY#2026-11-17', 'enrolments'),
  ],
  members: [],
  now: NOW,
  ...overrides,
});

describe('applyAnalyticsChange', () => {
  it('adds quiz question and score counters, and touches the summary', async () => {
    const table = memoryTable();
    const quiz = (
      kind: Delta['kind'],
      sk: string,
      attribute: string,
    ): Delta => ({
      kind,
      courseId: 'c1',
      sk,
      attribute,
      amount: 1,
    });
    await applyAnalyticsChange(
      coreTable,
      change({
        counts: [
          quiz('quizQuestionStats', 'QUIZ#quiz1#Q#q1', 'attempts'),
          quiz('quizQuestionStats', 'QUIZ#quiz1#Q#q1', 'misses'),
          quiz('quizScoreStats', 'QUIZ#quiz1#SCORES', 'band8'),
        ],
      }),
    );

    expect(table.items.get('analytics#c1|quiz#quiz1#q#q1')).toMatchObject({
      attempts: 1,
      misses: 1,
    });
    expect(table.items.get('analytics#c1|quiz#quiz1#scores')).toMatchObject({
      band8: 1,
    });
    expect(
      table.transactions[0].some(({ Update }) => Update?.Key.sk === 'summary'),
    ).toBe(true);
  });

  it('writes the counts and an event marker in one transaction', async () => {
    const table = memoryTable();
    await expect(applyAnalyticsChange(coreTable, change())).resolves.toBe(
      'applied',
    );

    expect(table.transactions).toHaveLength(1);
    const [marker, ...updates] = table.transactions[0];
    expect(marker.Put?.ConditionExpression).toContain('attribute_not_exists');
    expect(marker.Put?.Item).toMatchObject({
      pk: 'analyticsmark#c1',
      sk: 'event#e1',
      // 15 days after NOW, so it outlives the failure queue's 14.
      ttl: Math.floor(NOW.getTime() / 1000) + 15 * 86_400,
    });
    expect(updates).toHaveLength(2);
    expect(table.items.get('analytics#c1|summary')).toMatchObject({
      enrolments: 1,
    });
    expect(table.items.get('analytics#c1|day#2026-11-17')).toMatchObject({
      enrolments: 1,
    });
  });

  it('changes nothing when the same event is applied twice', async () => {
    const table = memoryTable();
    await applyAnalyticsChange(coreTable, change());
    await expect(applyAnalyticsChange(coreTable, change())).resolves.toBe(
      'already-applied',
    );
    expect(table.items.get('analytics#c1|summary')).toMatchObject({
      enrolments: 1,
    });
  });

  it('only ever adds to a counter', async () => {
    const table = memoryTable();
    await applyAnalyticsChange(
      coreTable,
      change({ counts: [count('SUMMARY', 'completed', -1)] }),
    );
    const update = table.transactions[0][1].Update;
    expect(update?.UpdateExpression).toMatch(/ADD #completed :completed_u0$/);
    expect(update?.UpdateExpression).not.toMatch(/SET #completed/);
    expect(update?.ExpressionAttributeValues[':completed_u0']).toBe(-1);
  });

  it('merges counts for one item into one update', async () => {
    const table = memoryTable();
    await applyAnalyticsChange(
      coreTable,
      change({
        counts: [count('SUMMARY', 'enrolments'), count('SUMMARY', 'completed')],
      }),
    );
    expect(table.transactions[0]).toHaveLength(2);
    expect(table.items.get('analytics#c1|summary')).toMatchObject({
      enrolments: 1,
      completed: 1,
    });
  });

  it('writes a member and its counter in a transaction of its own', async () => {
    const table = memoryTable();
    await applyAnalyticsChange(
      coreTable,
      change({
        counts: [],
        members: [member('DAY#2026-11-17'), member('WEEK#2026-W47')],
      }),
    );
    expect(table.transactions).toHaveLength(2);
    expect(table.items.get('analytics#c1|day#2026-11-17')).toMatchObject({
      activeLearners: 1,
    });
    expect(table.items.get('analytics#c1|week#2026-w47')).toMatchObject({
      activeLearners: 1,
    });
    expect(table.items.has('analyticsmark#c1|member#week#2026-w47#u1')).toBe(
      true,
    );
  });

  it('counts a learner once in a period, whichever event brought them', async () => {
    const table = memoryTable();
    const day = [member('DAY#2026-11-17')];
    await applyAnalyticsChange(
      coreTable,
      change({ eventId: 'e1', counts: [], members: day }),
    );
    await applyAnalyticsChange(
      coreTable,
      change({ eventId: 'e2', counts: [], members: day }),
    );
    expect(table.items.get('analytics#c1|day#2026-11-17')).toMatchObject({
      activeLearners: 1,
    });
  });

  it('expires a member marker 15 days after the end of its day or week', async () => {
    const table = memoryTable();
    await applyAnalyticsChange(
      coreTable,
      change({
        counts: [],
        members: [member('DAY#2026-11-17'), member('WEEK#2026-W47')],
      }),
    );
    const ttl = (id: string) =>
      table.items.get(`analyticsmark#c1|${id}`)?.ttl as number;
    const seconds = (iso: string) => Date.parse(iso) / 1000;
    expect(ttl('member#day#2026-11-17#u1')).toBe(
      seconds('2026-11-18T00:00:00Z') + 15 * 86_400,
    );
    // Week 47 of 2026 ends Sunday the 22nd, at the end of the day.
    expect(ttl('member#week#2026-w47#u1')).toBe(
      seconds('2026-11-23T00:00:00Z') + 15 * 86_400,
    );
  });

  it('does not let one cancelled part cancel the others', async () => {
    const table = memoryTable();
    await applyAnalyticsChange(
      coreTable,
      change({ counts: [], members: [member('DAY#2026-11-17')] }),
    );
    await applyAnalyticsChange(
      coreTable,
      change({
        members: [member('DAY#2026-11-17'), member('DAY#2026-11-17', 'u2')],
      }),
    );
    expect(table.items.get('analytics#c1|day#2026-11-17')).toMatchObject({
      enrolments: 1,
      activeLearners: 2,
    });
  });

  it('rethrows any failure other than an applied marker', async () => {
    memoryTable(() => true);
    await expect(applyAnalyticsChange(coreTable, change())).rejects.toThrow(
      'ProvisionedThroughputExceeded',
    );
  });

  it('tries a transaction again when it conflicts with another, then succeeds', async () => {
    const table = memoryTable();
    const memoryWrite = table.write.getMockImplementation() as unknown as (
      callback: never,
    ) => { go: () => Promise<unknown> };
    let conflicts = 2;
    vi.spyOn(coreTable.transaction, 'write').mockImplementation(((
      callback: never,
    ) => {
      const inner = memoryWrite(callback);
      return {
        go: async () =>
          conflicts-- > 0
            ? {
                canceled: true,
                data: [{ code: 'None' }, { code: 'TransactionConflict' }],
              }
            : inner.go(),
      };
    }) as never);

    await expect(applyAnalyticsChange(coreTable, change())).resolves.toBe(
      'applied',
    );
    expect(table.items.get('analytics#c1|summary')).toMatchObject({
      enrolments: 1,
    });
  });

  it('gives up on a conflict that does not clear', async () => {
    vi.spyOn(coreTable.transaction, 'write').mockImplementation((() => ({
      go: async () => ({
        canceled: true,
        data: [{ code: 'None' }, { code: 'TransactionConflict' }],
      }),
    })) as never);
    await expect(applyAnalyticsChange(coreTable, change())).rejects.toThrow(
      /cancelled/,
    );
  });

  it('throws when a transaction is cancelled for another reason', async () => {
    vi.spyOn(coreTable.transaction, 'write').mockImplementation((() => ({
      go: async () => ({
        canceled: true,
        data: [{ code: 'TransactionConflict' }],
      }),
    })) as never);
    await expect(applyAnalyticsChange(coreTable, change())).rejects.toThrow(
      /cancelled/,
    );
  });
});
