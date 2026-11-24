/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { createCoreTableService } from '../service.js';

// An in-memory stand-in for the part of the core table service the order and
// payment-connection helpers use, so their conditions, transactions and races
// can run without DynamoDB. It keeps what matters: a condition is checked
// against the item as stored, a transaction applies all of its items or none,
// two operations on one item in a transaction are refused, and `create`
// fails when the item exists. `where` callbacks may join predicates with AND
// and OR.

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
export type Row = Record<string, any>;

const KEYS: Record<string, (key: Row) => string> = {
  order: (k) => k.orderId,
  course: (k) => k.courseId,
  enrolment: (k) => `${k.courseId}|${k.userId}`,
  paymentConnection: () => 'singleton',
  platformBrand: () => 'singleton',
  paymentChange: (k) => k.changeId,
  certificate: (k) => `${k.userId}|${k.courseId}`,
  earningOrder: (k) => k.orderId,
  earningEntry: (k) =>
    `${k.instructorId}|${k.courseId}|${k.occurredAt}|${k.entryId}`,
  earningDay: (k) => `${k.instructorId}|${k.day}|${k.courseId}|${k.currency}`,
  payout: (k) => `${k.instructorId}|${k.createdAt}|${k.payoutId}`,
  coupon: (k) => `${k.courseId}|${k.code}`,
  couponRedemption: (k) => `${k.courseId}|${k.code}|${k.userId}`,
  payoutAccount: (k) => `${k.instructorId}|${k.accountId}|${k.mode}`,
};

// The sort keys of the entities a range query reads, as their templates build
// them, and the partial key a `between` bound stands for.
const SORT_KEYS: Record<string, (k: Row) => string> = {
  earningDay: (k) => `D#${k.day}#${k.courseId}#${k.currency}`,
  earningEntry: (k) => `L#${k.courseId}#${k.occurredAt}#${k.entryId}`,
  payout: (k) => `P#${k.createdAt}#${k.payoutId}`,
};
const BOUNDS: Record<string, (k: Row) => string> = {
  earningDay: (k) => `D#${k.day}`,
  earningEntry: (k) => `L#${k.courseId}#${k.occurredAt}`,
};

type Test = (row?: Row) => boolean;

// The attribute and operation helpers a `where` callback receives. Each
// operation returns a JavaScript expression over `ref`, which reads an
// attribute of the item as stored, so the string the callback builds (joined
// with AND and OR, and `<` between two `name`s) can be evaluated. A
// comparison with a missing attribute is false, but `ne` is true.
const evaluate = (where?: (attr: any, op: any) => string): Test => {
  const attr = new Proxy({}, { get: (_t, name) => name });
  const read = (name: string) => `ref(${JSON.stringify(name)})`;
  const compare = (symbol: string) => (name: string, value: any) =>
    `(${read(name)} !== undefined && ${read(name)} ${symbol} ${JSON.stringify(value)})`;
  const op = {
    eq: compare('==='),
    ne: (name: string, value: any) =>
      `(${read(name)} !== ${JSON.stringify(value)})`,
    lt: compare('<'),
    lte: compare('<='),
    gt: compare('>'),
    gte: compare('>='),
    exists: (name: string) => `(${read(name)} !== undefined)`,
    notExists: (name: string) => `(${read(name)} === undefined)`,
    name: (name: string) => read(name),
  };
  const expression = where?.(attr, op) ?? '';
  if (expression === '') return () => true;
  const source = expression.replace(/ AND /g, ' && ').replace(/ OR /g, ' || ');
  const test = new Function('ref', `return (${source})`) as (
    ref: (name: string) => unknown,
  ) => boolean;
  return (row) => Boolean(test((name) => row?.[name]));
};

export interface Operation {
  entity: string;
  id: string;
  kind: 'create' | 'patch' | 'check' | 'upsert';
  holds: Test;
  apply: (row: Row | undefined) => Row | undefined;
}

export const createFakeCoreTable = () => {
  const tables: Record<string, Map<string, Row>> = {};
  const table = (entity: string) => (tables[entity] ??= new Map());
  const log: {
    transactions: number;
    cancelled: number;
    reasons: { code: string }[];
  } = { transactions: 0, cancelled: 0, reasons: [] };
  const hooks: { beforeTransaction?: () => void } = {};

  const conditionFailed = () =>
    Object.assign(new Error('The conditional request failed'), {
      cause: Object.assign(new Error('failed'), {
        name: 'ConditionalCheckFailedException',
      }),
    });

  const run = (operations: Operation[]) => {
    hooks.beforeTransaction?.();
    log.transactions++;
    const ids = operations.map((o) => `${o.entity} ${o.id}`);
    const duplicates = new Set(ids).size !== ids.length;
    // DynamoDB's per-item cancellation reasons, as ElectroDB returns them.
    const reasons = operations.map((o) => {
      const row = table(o.entity).get(o.id);
      const holds =
        !(o.kind === 'create' && row) &&
        !(o.kind === 'patch' && !row) &&
        o.holds(row);
      return { code: holds ? 'None' : 'ConditionalCheckFailed' };
    });
    const ok = !duplicates && reasons.every((r) => r.code === 'None');
    log.reasons = reasons;
    if (!ok) {
      log.cancelled++;
      return false;
    }
    for (const o of operations) {
      const next = o.apply(table(o.entity).get(o.id));
      if (next) table(o.entity).set(o.id, next);
    }
    return true;
  };

  // A query on an instructor's partition, optionally `between` two bounds,
  // paged by `limit` and a cursor (the last sort key returned).
  const rangeQuery = (name: string, key: Row) => {
    let low = '';
    let high = '\uffff';
    const chain: any = {
      between: (from: Row, to: Row) => {
        low = BOUNDS[name]!(from);
        high = BOUNDS[name]!(to);
        return chain;
      },
      go: async ({
        cursor,
        limit,
        order,
      }: {
        cursor?: string;
        limit?: number;
        pages?: 'all';
        order?: 'asc' | 'desc';
      } = {}) => {
        const sorted = [...table(name).values()]
          .filter((row) => row.instructorId === key.instructorId)
          .map((row) => ({ sk: SORT_KEYS[name]!(row), row }))
          .filter(({ sk }) => sk >= low && sk <= high)
          .sort((a, b) => (a.sk < b.sk ? -1 : 1) * (order === 'desc' ? -1 : 1))
          .filter(({ sk }) => cursor === undefined || sk > cursor);
        const page = limit === undefined ? sorted : sorted.slice(0, limit);
        return {
          data: page.map(({ row }) => structuredClone(row)),
          cursor:
            limit !== undefined && sorted.length > limit
              ? page[page.length - 1]!.sk
              : null,
        };
      },
    };
    return chain;
  };

  // A query on an index: the rows that match, in index order, `limit` at most.
  const listing = (
    name: string,
    matches: (row: Row) => boolean,
    order: string,
  ) => ({
    go: async ({ limit }: { limit?: number; pages?: 'all' } = {}) => {
      const rows = [...table(name).values()]
        .filter(matches)
        .sort((a, b) =>
          `${a[order]}#${a.entryId}` < `${b[order]}#${b.entryId}` ? -1 : 1,
        )
        .map((row) => structuredClone(row));
      return { data: limit === undefined ? rows : rows.slice(0, limit) };
    },
  });

  // An earning entry is created in its instructor's open partition.
  const withSettlement = (name: string, item: Row): Row =>
    name === 'earningEntry'
      ? { ...item, settlement: `open#${item.instructorId}` }
      : item;

  const entity = (name: string) => {
    const idOf = KEYS[name]!;
    const patch = (key: Row) => {
      let changes: Row = {};
      let adds: Row = {};
      let subtracts: Row = {};
      let removed: string[] = [];
      let where: ((attr: any, op: any) => string) | undefined;
      const build = (): Operation => ({
        entity: name,
        id: idOf(key),
        kind: 'patch',
        holds: evaluate(where),
        apply: (row) => {
          const next = { ...row, ...changes };
          // ElectroDB moves an entry to its payout's settlement key when
          // `payoutId` is set; clearing it is the caller's `settlement`.
          if (changes.payoutId) next.settlement = `payout#${changes.payoutId}`;
          for (const [field, amount] of Object.entries(adds)) {
            next[field] = (next[field] ?? 0) + (amount as number);
          }
          for (const [field, amount] of Object.entries(subtracts)) {
            next[field] = (next[field] ?? 0) - (amount as number);
          }
          for (const field of removed) delete next[field];
          return next;
        },
      });
      const chain: any = {
        set: (values: Row) => ((changes = { ...changes, ...values }), chain),
        add: (values: Row) => ((adds = values), chain),
        subtract: (values: Row) => ((subtracts = values), chain),
        remove: (names: string[]) => ((removed = names), chain),
        // As ElectroDB's: `where` ends the chain of changes, so `set`, `add`
        // and `remove` after it don't exist.
        where: (fn: typeof where) => {
          where = fn;
          return { where: chain.where, commit: chain.commit, go: chain.go };
        },
        commit: build,
        go: async () => {
          if (!run([build()])) throw conditionFailed();
          return { data: structuredClone(table(name).get(idOf(key))) };
        },
      };
      return chain;
    };
    return {
      get: (key: Row) => ({
        go: async () => ({
          data: structuredClone(table(name).get(idOf(key))) ?? null,
        }),
      }),
      create: (item: Row) => ({
        commit: (): Operation => ({
          entity: name,
          id: idOf(item),
          kind: 'create',
          holds: () => true,
          apply: () => withSettlement(name, { ...item }),
        }),
        go: async () => {
          const op: Operation = {
            entity: name,
            id: idOf(item),
            kind: 'create',
            holds: () => true,
            apply: () => withSettlement(name, { ...item }),
          };
          if (!run([op])) throw conditionFailed();
          return { data: structuredClone(item) };
        },
      }),
      check: (key: Row) => {
        let where: ((attr: any, op: any) => string) | undefined;
        const chain: any = {
          where: (fn: typeof where) => ((where = fn), chain),
          commit: (): Operation => ({
            entity: name,
            id: idOf(key),
            kind: 'check',
            holds: evaluate(where),
            apply: () => undefined,
          }),
        };
        return chain;
      },
      patch,
      delete: (key: Row) => {
        let where: ((attr: any, op: any) => string) | undefined;
        const build = (): Operation => ({
          entity: name,
          id: idOf(key),
          kind: 'patch',
          holds: evaluate(where),
          apply: () => {
            table(name).delete(idOf(key));
            return undefined;
          },
        });
        const chain: any = {
          where: (fn: typeof where) => ((where = fn), chain),
          commit: build,
          go: async () => {
            if (!run([build()])) throw conditionFailed();
            return { data: null };
          },
        };
        return chain;
      },
      // An update that creates the item when it is missing and adds to its
      // numbers, as DynamoDB's ADD does.
      update: (key: Row) => {
        let adds: Row = {};
        const build = (): Operation => ({
          entity: name,
          id: idOf(key),
          kind: 'upsert',
          holds: () => true,
          apply: (row) => {
            const next = { ...key, ...row };
            for (const [field, amount] of Object.entries(adds)) {
              next[field] = (next[field] ?? 0) + (amount as number);
            }
            return next;
          },
        });
        const chain: any = {
          add: (values: Row) => ((adds = values), chain),
          commit: build,
          go: async () => {
            run([build()]);
            return { data: structuredClone(table(name).get(idOf(key))) };
          },
        };
        return chain;
      },
      query: {
        // Orders of one student for one course, oldest first.
        byStudentCourse: ({ userId, courseId }: Row) => ({
          go: async () => ({
            data: [...table(name).values()]
              .filter((r) => r.userId === userId && r.courseId === courseId)
              .sort((a, b) => (a.orderId < b.orderId ? -1 : 1))
              .map((r) => structuredClone(r)),
          }),
        }),
        bySettlement: ({ settlement }: Row) =>
          listing(name, (row) => row.settlement === settlement, 'releaseAt'),
        payoutsByStatus: ({ status }: Row) =>
          listing(name, (row) => row.status === status, 'payoutId'),
        byStatus: ({ accountId, mode, status }: Row) =>
          listing(
            name,
            (row) =>
              row.accountId === accountId &&
              row.mode === mode &&
              row.status === status,
            'instructorId',
          ),
        primary: (key: Row) =>
          name === 'couponRedemption'
            ? {
                go: async () => ({
                  data: [...table(name).values()]
                    .filter(
                      (r) => r.courseId === key.courseId && r.code === key.code,
                    )
                    .map((r) => structuredClone(r)),
                }),
              }
            : SORT_KEYS[name]
              ? rangeQuery(name, key)
              : {
                  go: async () => ({
                    data: [...table(name).values()]
                      .sort((a, b) => (a.changeId < b.changeId ? 1 : -1))
                      .map((r) => structuredClone(r)),
                  }),
                },
      },
    };
  };

  const entities = new Proxy({} as Record<string, any>, {
    get: (cache, name: string) => (cache[name] ??= entity(name)),
  });

  const coreTable = {
    entities,
    transaction: {
      write: (build: (e: typeof entities) => Operation[]) => ({
        go: async () => {
          const canceled = !run(build(entities));
          return { canceled, data: canceled ? log.reasons : [] };
        },
      }),
    },
  } as unknown as CoreTable;

  return {
    coreTable,
    log,
    hooks,
    /** Items of one entity, as stored. */
    rows: (name: string) => [...table(name).values()],
    row: (name: string, key: Row) => table(name).get(KEYS[name]!(key)),
    put: (name: string, item: Row) => {
      table(name).set(KEYS[name]!(item), structuredClone(item));
    },
  };
};

describe('the fake core table', () => {
  it('cancels a transaction whose condition fails and keeps every write out', async () => {
    const fake = createFakeCoreTable();
    fake.put('order', { orderId: 'o', status: 'paid' });
    const { canceled } = await fake.coreTable.transaction
      .write(({ order, course }: any) => [
        course.create({ courseId: 'c' }).commit(),
        order
          .patch({ orderId: 'o' })
          .set({ status: 'x' })
          .where((a: any, op: any) => op.eq(a.status, 'pending'))
          .commit(),
      ])
      .go();
    expect(canceled).toBe(true);
    expect(fake.rows('course')).toEqual([]);
  });

  it('refuses two operations on one item and a create over an existing one', async () => {
    const fake = createFakeCoreTable();
    fake.put('course', { courseId: 'c' });
    const both = await fake.coreTable.transaction
      .write(({ course }: any) => [
        course.patch({ courseId: 'c' }).set({ a: 1 }).commit(),
        course.patch({ courseId: 'c' }).set({ b: 1 }).commit(),
      ])
      .go();
    const again = await fake.coreTable.transaction
      .write(({ course }: any) => [course.create({ courseId: 'c' }).commit()])
      .go();
    expect([both.canceled, again.canceled]).toEqual([true, true]);
  });

  it('evaluates OR', async () => {
    const fake = createFakeCoreTable();
    fake.put('course', { courseId: 'c', a: 1 });
    const { canceled } = await fake.coreTable.transaction
      .write(({ course }: any) => [
        course
          .check({ courseId: 'c' })
          .where((a: any, op: any) => `${op.eq(a.a, 2)} OR ${op.eq(a.a, 1)}`)
          .commit(),
      ])
      .go();
    expect(canceled).toBe(false);
  });
});
