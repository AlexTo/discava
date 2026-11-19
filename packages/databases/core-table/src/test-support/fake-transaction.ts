/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// An in-memory stand-in for the entities a `*Writes` helper builds its
// transaction from. It keeps DynamoDB's transaction rules that matter in
// tests: every condition is checked against the table as it was before the
// transaction, all of the items apply or none, and two operations on one item
// are refused. Transactions run one at a time, which is the order DynamoDB
// would give two that raced; each is built from a read taken beforehand, so a
// later one meets what the earlier one wrote.

export type Row = Record<string, any>;

export interface Operation {
  /** The row's key in the table, from `FakeTable.keyOf`. */
  key: string;
  /** Whether the transaction may go ahead, given the item as stored. */
  allowed: (row?: Row) => boolean;
  apply: (row?: Row) => Row | undefined;
}

type Where = (attr: any, op: any) => string;

export class Cancelled extends Error {
  constructor(readonly reasons: { code: string }[]) {
    super('TransactionCanceledException');
  }
}

// A `where` callback builds its condition from the operations below, each of
// which returns a token standing for its predicate; DynamoDB treats a
// comparison with a missing attribute as false (but `<>` as true).
const conditionOf = (where?: Where) => {
  const tests: ((row?: Row) => boolean)[] = [];
  const token = (test: (row?: Row) => boolean) => {
    tests.push(test);
    return `[${tests.length - 1}]`;
  };
  const attr = new Proxy({}, { get: (_, name) => String(name) });
  const op = {
    eq: (n: string, v: unknown) => token((r) => r?.[n] === v),
    ne: (n: string, v: unknown) => token((r) => r?.[n] !== v),
    lt: (n: string, v: number) =>
      token((r) => r?.[n] !== undefined && r[n] < v),
    gte: (n: string, v: number) =>
      token((r) => r?.[n] !== undefined && r[n] >= v),
    exists: (n: string) => token((r) => r?.[n] !== undefined),
    notExists: (n: string) => token((r) => r?.[n] === undefined),
    contains: (n: string, v: string) =>
      token((r) => (r?.[n] as Set<string> | undefined)?.has(v) ?? false),
    name: (n: string) => `@${n}`,
    value: (_n: string, v: number) => `#${v}`,
  };
  let expression = where?.(attr, op) ?? '';
  expression = expression.replace(
    /size\(@(\w+)\) < #(\d+)/g,
    (_all, n: string, v: string) =>
      token((r) => r?.[n] !== undefined && r[n].size < Number(v)),
  );
  const source = expression
    .replace(/ AND /g, ' && ')
    .replace(/ OR /g, ' || ')
    .replace(/\[(\d+)\]/g, 't($1)');
  if (!/^[\s\d&|()t]*$/.test(source)) {
    throw new Error(`The fake cannot read ${expression}`);
  }
  const evaluate = new Function('t', `return ${source || 'true'}`) as (
    t: (n: number) => boolean,
  ) => boolean;
  return (row?: Row) => evaluate((n) => tests[n]!(row));
};

type Mode = 'create' | 'patch' | 'update' | 'check' | 'delete';

export interface FakeTableOptions {
  /** The attributes that make up each entity's key, in order. */
  keyFields: Record<string, string[]>;
  /** What an entity's `create` fills in when the item leaves it out. */
  createDefaults?: Record<string, Row>;
  /** The table's rows, when a test builds them before the fake. */
  rows?: Map<string, Row>;
}

/**
 * The fake's rows and entities. `entities()` is what a `*Writes` helper takes;
 * `transact` runs the operations it returns.
 */
export const createFakeTable = ({
  keyFields,
  createDefaults = {},
  rows = new Map<string, Row>(),
}: FakeTableOptions) => {
  const keyOf = (entity: string, row: Row) =>
    `${entity}|${keyFields[entity]!.map((f) => row[f] ?? '').join('|')}`;

  const builder = (entity: string, key: Row, mode: Mode, item?: Row) => {
    let where: Where | undefined;
    const changes: { set: Row; add: Row; subtract: Row; remove: string[] } = {
      set: {},
      add: {},
      subtract: {},
      remove: [],
    };
    const self: any = {
      set: (v: Row) => (Object.assign(changes.set, v), self),
      add: (v: Row) => (Object.assign(changes.add, v), self),
      subtract: (v: Row) => (Object.assign(changes.subtract, v), self),
      remove: (names: string[]) => (changes.remove.push(...names), self),
      where: (fn: Where) => ((where = fn), self),
      commit: (): Operation => {
        const holds = conditionOf(where);
        return {
          key: keyOf(entity, item ?? key),
          allowed: (row) => {
            if (mode === 'create') {
              return row === undefined;
            }
            if ((mode === 'patch' || mode === 'delete') && row === undefined) {
              return false;
            }
            return holds(row);
          },
          apply: (row) => {
            if (mode === 'create') {
              return { ...createDefaults[entity], ...item };
            }
            if (mode === 'delete') {
              return undefined;
            }
            if (mode === 'check') {
              return row;
            }
            // `update` writes the item if it isn't there yet.
            const next: Row =
              mode === 'update' ? { ...key, ...row } : { ...row };
            Object.assign(next, changes.set);
            for (const [n, v] of Object.entries(changes.add)) {
              next[n] = Array.isArray(v)
                ? new Set([...(next[n] ?? []), ...v])
                : (next[n] ?? 0) + (v as number);
            }
            for (const [n, v] of Object.entries(changes.subtract)) {
              next[n] = (next[n] ?? 0) - (v as number);
            }
            for (const n of changes.remove) {
              delete next[n];
            }
            return next;
          },
        };
      },
    };
    return self;
  };

  const entities = <T = any>(): T =>
    Object.fromEntries(
      Object.keys(keyFields).map((name) => [
        name,
        {
          create: (item: Row) => builder(name, item, 'create', item),
          patch: (key: Row) => builder(name, key, 'patch'),
          update: (key: Row) => builder(name, key, 'update'),
          check: (key: Row) => builder(name, key, 'check'),
          delete: (key: Row) => builder(name, key, 'delete'),
        },
      ]),
    ) as T;

  /** Applies every operation or, if a condition fails, throws `Cancelled`. */
  const transact = (operations: Operation[]) => {
    const keys = operations.map((o) => o.key);
    if (new Set(keys).size !== keys.length) {
      throw new Error(
        'Transaction request cannot include multiple operations on one item',
      );
    }
    const reasons = operations.map((o) => ({
      code: o.allowed(rows.get(o.key)) ? 'None' : 'ConditionalCheckFailed',
    }));
    if (reasons.some((r) => r.code !== 'None')) {
      throw new Cancelled(reasons);
    }
    const next = operations.map(
      (o) => [o.key, o.apply(rows.get(o.key))] as const,
    );
    for (const [key, row] of next) {
      if (row === undefined) {
        rows.delete(key);
      } else {
        rows.set(key, row);
      }
    }
  };

  /** Whether the transaction went through. */
  const succeeds = (operations: Operation[]) => {
    try {
      transact(operations);
      return true;
    } catch (error) {
      if (error instanceof Cancelled) {
        return false;
      }
      throw error;
    }
  };

  /** The rows of one entity. */
  const rowsOf = (entity: string) =>
    [...rows.entries()]
      .filter(([key]) => key.startsWith(`${entity}|`))
      .map(([, row]) => row);

  return { rows, keyOf, entities, transact, succeeds, rowsOf };
};
