/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { createCoreTableService } from '../service.js';

// An in-memory stand-in for the part of the core table service that the
// notification helpers use, so their transactions and conditions can be run
// without DynamoDB. It understands only what those helpers call: get, create,
// patch with set/add/subtract/where, a primary-index range query, and
// service.transaction.write, which applies its items all or nothing.

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
type Row = Record<string, any>;

const KEYS: Record<string, (r: Row) => string> = {
  notification: (r) => `${r.userId}|${r.occurredAt}#${r.id}`,
  notificationState: (r) => r.userId,
  notificationBroadcast: (r) => r.id,
};
const DEFAULTS: Record<string, () => Row> = {
  notification: () => ({ email: { state: 'pending' } }),
  notificationState: () => ({}),
  notificationBroadcast: () => ({ status: 'pending' }),
};

const path = (row: Row, name: string) =>
  name.split('.').reduce((v, k) => v?.[k], row);

// What the fake's `where` callback gets, standing for ElectroDB's attribute
// and operation helpers; conditions come back as strings joined by AND.
const attrs = new Proxy(
  {},
  {
    get: (_t, name: string) =>
      new Proxy({ __path: name } as Row, {
        get: (target, sub: string) =>
          sub === '__path'
            ? target.__path
            : { __path: `${target.__path}.${sub}` },
      }),
  },
);
const ops = {
  eq: (a: { __path: string }, v: unknown) =>
    `eq ${a.__path} ${JSON.stringify(v)}`,
  notExists: (a: { __path: string }) => `notExists ${a.__path}`,
};
const holds = (row: Row | undefined, condition: string) =>
  condition.split(' AND ').every((c) => {
    const [kind, name, ...rest] = c.split(' ');
    const value = path(row ?? {}, name!);
    if (kind === 'notExists') return value === undefined;
    return JSON.stringify(value) === rest.join(' ');
  });

export type FakeItem = {
  entity: string;
  kind: 'create' | 'patch';
  key: Row;
  item?: Row;
  set: Row;
  add: Row;
  subtract: Row;
  conditions: string[];
};

export const createFakeNotificationTable = () => {
  const rows: Record<string, Map<string, Row>> = {
    notification: new Map(),
    notificationState: new Map(),
    notificationBroadcast: new Map(),
  };
  const log = { transactions: 0, cancelled: 0 };
  // Run before each transaction applies: lets a test change the table at the
  // moment a competing writer would.
  const hooks: { beforeTransaction?: () => void } = {};

  const entity = (name: string) => {
    const keyOf = KEYS[name]!;
    return {
      get: (key: Row) => ({
        go: async () => {
          const row = rows[name]!.get(keyOf(key));
          return { data: row && structuredClone(row) };
        },
      }),
      create: (item: Row) => ({
        commit: (): FakeItem => ({
          entity: name,
          kind: 'create',
          key: item,
          item,
          set: {},
          add: {},
          subtract: {},
          conditions: [],
        }),
      }),
      patch: (key: Row) => {
        const built: FakeItem = {
          entity: name,
          kind: 'patch',
          key,
          set: {},
          add: {},
          subtract: {},
          conditions: [],
        };
        const chain = {
          set: (v: Row) => ((built.set = { ...built.set, ...v }), chain),
          add: (v: Row) => ((built.add = { ...built.add, ...v }), chain),
          subtract: (v: Row) => (
            (built.subtract = { ...built.subtract, ...v }), chain
          ),
          where: (cb: (a: unknown, o: unknown) => string) => (
            built.conditions.push(cb(attrs, ops)), chain
          ),
          commit: () => built,
          go: async () => {
            const row = rows[name]!.get(keyOf(key));
            if (!row || !built.conditions.every((c) => holds(row, c))) {
              throw Object.assign(new Error('conditional'), {
                cause: Object.assign(new Error('conditional'), {
                  name: 'ConditionalCheckFailedException',
                }),
              });
            }
            apply(built);
            return { data: row };
          },
        };
        return chain;
      },
      query: {
        primary: ({ userId }: Row) => {
          const pos = (k: Row) => `${k.occurredAt}#${k.id}`;
          const run = (keep: (p: string) => boolean) => ({
            go: async ({ limit = Infinity }: { limit?: number } = {}) => ({
              data: [...rows.notification!.values()]
                .filter((r) => r.userId === userId && keep(pos(r)))
                .sort((a, b) => (pos(a) < pos(b) ? -1 : 1))
                .slice(0, limit)
                .map((r) => structuredClone(r)),
            }),
          });
          return {
            between: (a: Row, b: Row) => run((p) => p >= pos(a) && p <= pos(b)),
            lte: (b: Row) => run((p) => p <= pos(b)),
          };
        },
      },
    };
  };

  const apply = (it: FakeItem) => {
    const table = rows[it.entity]!;
    const k = KEYS[it.entity]!(it.key);
    if (it.kind === 'create') {
      table.set(k, {
        ...DEFAULTS[it.entity]!(),
        createdAt: 'now',
        ...structuredClone(it.item!),
      });
      return;
    }
    const row = table.get(k)!;
    Object.assign(row, structuredClone(it.set));
    for (const [n, v] of Object.entries(it.add)) row[n] = (row[n] ?? 0) + v;
    for (const [n, v] of Object.entries(it.subtract)) row[n] = row[n] - v;
  };

  const service = {
    entities: {
      notification: entity('notification'),
      notificationState: entity('notificationState'),
      notificationBroadcast: entity('notificationBroadcast'),
    },
    transaction: {
      write: (cb: (entities: unknown) => FakeItem[]) => ({
        go: async () => {
          hooks.beforeTransaction?.();
          log.transactions++;
          const items = cb(service.entities);
          const failed = items.map((it) => {
            const row = rows[it.entity]!.get(KEYS[it.entity]!(it.key));
            const ok =
              it.kind === 'create'
                ? row === undefined
                : row !== undefined &&
                  it.conditions.every((c) => holds(row, c));
            return ok ? { code: 'None' } : { code: 'ConditionalCheckFailed' };
          });
          if (failed.some((f) => f.code !== 'None')) {
            log.cancelled++;
            return { canceled: true, data: failed };
          }
          for (const it of items) apply(it);
          return { canceled: false, data: items.map(() => ({ code: 'None' })) };
        },
      }),
    },
  } as unknown as CoreTable;

  return { service, rows, log, hooks };
};

describe('the fake notification table', () => {
  it('creates once and refuses a second create in a transaction', async () => {
    const { service, rows } = createFakeNotificationTable();
    const item = () =>
      (service.entities.notificationState as any)
        .create({ userId: 'u', unreadCount: 1, version: 1 })
        .commit();
    expect(
      (await service.transaction.write(() => [item()]).go()).canceled,
    ).toBe(false);
    expect(
      (await service.transaction.write(() => [item()]).go()).canceled,
    ).toBe(true);
    expect(rows.notificationState!.size).toBe(1);
  });
});
