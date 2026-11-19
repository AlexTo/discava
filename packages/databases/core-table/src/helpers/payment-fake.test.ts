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
  paymentChange: (k) => k.changeId,
  certificate: (k) => `${k.userId}|${k.courseId}`,
};

type Test = (row?: Row) => boolean;

// The attribute and operation helpers a `where` callback receives. Each
// operation returns a token standing for its predicate, so the expression
// string the callback builds can be evaluated afterwards.
const evaluate = (where?: (attr: any, op: any) => string): Test => {
  const tests: Test[] = [];
  const token = (test: Test) => {
    tests.push(test);
    return `<${tests.length - 1}>`;
  };
  const attr = new Proxy({}, { get: (_t, name) => name });
  const compare =
    (cmp: (a: any, b: any) => boolean) => (name: string, value: any) =>
      token((row) => row?.[name] !== undefined && cmp(row[name], value));
  const op = {
    eq: compare((a, b) => a === b),
    ne: (name: string, value: any) => token((row) => row?.[name] !== value),
    lt: compare((a, b) => a < b),
    lte: compare((a, b) => a <= b),
    gt: compare((a, b) => a > b),
    gte: compare((a, b) => a >= b),
    exists: (name: string) => token((row) => row?.[name] !== undefined),
    notExists: (name: string) => token((row) => row?.[name] === undefined),
  };
  const expression = where?.(attr, op) ?? '';
  return (row) => {
    const evalOr = (text: string): boolean =>
      text.split(/\s+OR\s+/).some((part) =>
        part.split(/\s+AND\s+/).every((term) => {
          const id = /<(\d+)>/.exec(term);
          return id ? tests[Number(id[1])]!(row) : true;
        }),
      );
    return expression === '' ? true : evalOr(expression);
  };
};

export interface Operation {
  entity: string;
  id: string;
  kind: 'create' | 'patch' | 'check';
  holds: Test;
  apply: (row: Row | undefined) => Row | undefined;
}

export const createFakeCoreTable = () => {
  const tables: Record<string, Map<string, Row>> = {};
  const table = (entity: string) => (tables[entity] ??= new Map());
  const log = { transactions: 0, cancelled: 0 };
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
    const ok =
      new Set(ids).size === ids.length &&
      operations.every((o) => {
        const row = table(o.entity).get(o.id);
        if (o.kind === 'create' && row) return false;
        if (o.kind === 'patch' && !row) return false;
        return o.holds(row);
      });
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

  const entity = (name: string) => {
    const idOf = KEYS[name]!;
    const patch = (key: Row) => {
      let changes: Row = {};
      let removed: string[] = [];
      let where: ((attr: any, op: any) => string) | undefined;
      const build = (): Operation => ({
        entity: name,
        id: idOf(key),
        kind: 'patch',
        holds: evaluate(where),
        apply: (row) => {
          const next = { ...row, ...changes };
          for (const field of removed) delete next[field];
          return next;
        },
      });
      const chain: any = {
        set: (values: Row) => ((changes = { ...changes, ...values }), chain),
        remove: (names: string[]) => ((removed = names), chain),
        where: (fn: typeof where) => ((where = fn), chain),
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
          apply: () => ({ ...item }),
        }),
        go: async () => {
          const op: Operation = {
            entity: name,
            id: idOf(item),
            kind: 'create',
            holds: () => true,
            apply: () => ({ ...item }),
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
        primary: () => ({
          go: async () => ({
            data: [...table(name).values()]
              .sort((a, b) => (a.changeId < b.changeId ? 1 : -1))
              .map((r) => structuredClone(r)),
          }),
        }),
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
        go: async () => ({ canceled: !run(build(entities)), data: [] }),
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
