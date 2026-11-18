/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { checkTableInvariants, type TableSnapshot } from './invariants.js';
import { type ReviewWrite, reviewerName, reviewWrites } from './review.js';

// An in-memory stand-in for the entities reviewWrites builds its transaction
// from. It keeps DynamoDB's transaction rules that matter here: every
// condition is checked against the table as it was before the transaction,
// all of the items apply or none, and two operations on one item are refused.
// Transactions run one at a time, which is the order DynamoDB would give two
// that raced; each is built from a read taken beforehand, so a later one
// meets what the earlier one wrote.

type Row = Record<string, any>;
interface Operation {
  entity: string;
  key: Row;
  /** Whether the transaction may go ahead, given the item as stored. */
  allowed: (row: Row | undefined) => boolean;
  apply: (row: Row | undefined, table: Table) => Row | undefined;
}
type Table = Map<string, Row>;

class Cancelled extends Error {
  constructor(readonly reasons: { code: string }[]) {
    super('TransactionCanceledException');
  }
}

const rowKey = (entity: string, key: Row) =>
  `${entity} ${key.courseId} ${key.userId ?? ''}`;

// `where` callbacks build their condition from `op.eq(attr.version, 2)`
// joined with AND; each call returns a token standing for its predicate.
const conditionOf = (where?: (attr: any, op: any) => string) => {
  const predicates = new Map<string, (row?: Row) => boolean>();
  const token = (test: (row?: Row) => boolean) => {
    const id = `<${predicates.size}>`;
    predicates.set(id, test);
    return id;
  };
  const attr = new Proxy({}, { get: (_, name) => name });
  const op = {
    eq: (name: string, value: unknown) => token((row) => row?.[name] === value),
    ne: (name: string, value: unknown) => token((row) => row?.[name] !== value),
    gte: (name: string, value: number) =>
      token((row) => (row?.[name] ?? Number.NEGATIVE_INFINITY) >= value),
    exists: (name: string) => token((row) => row?.[name] !== undefined),
    notExists: (name: string) => token((row) => row?.[name] === undefined),
  };
  const expression = where?.(attr, op) ?? '';
  return (row?: Row) =>
    [...expression.matchAll(/<\d+>/g)].every(([id]) =>
      predicates.get(id!)!(row),
    );
};

const builder = (entity: string, key: Row, base: Partial<Operation>) => {
  let where: ((attr: any, op: any) => string) | undefined;
  let removed: string[] = [];
  let changes: Row = {};
  const self: any = {
    set: (values: Row) => ((changes = { ...changes, ...values }), self),
    add: (values: Row) => ((changes = { ...changes, ...values }), self),
    remove: (names: string[]) => ((removed = names), self),
    where: (fn: typeof where) => ((where = fn), self),
    commit: (): Operation & { changes: Row; removed: string[] } => {
      const holds = conditionOf(where);
      return {
        entity,
        key,
        allowed: (row) => (base.allowed?.(row) ?? true) && holds(row),
        apply: base.apply ?? ((row) => ({ ...row, ...changes })),
        changes,
        removed,
      };
    },
  };
  return self;
};

const fakeEntities = () => {
  const patching = (entity: string) => (key: Row) => builder(entity, key, {});
  const checking = (entity: string) => (key: Row) =>
    builder(entity, key, { apply: (row) => row });
  return {
    review: {
      create: (item: Row) =>
        builder('review', item, {
          allowed: (row) => row === undefined,
          apply: () => item,
        }),
      patch: (key: Row) => {
        const b = builder('review', key, {});
        const commit = b.commit;
        b.commit = () => {
          const op = commit() as Operation & {
            changes: Row;
            removed: string[];
          };
          return {
            ...op,
            allowed: (row) => row !== undefined && op.allowed(row),
            apply: (row) => {
              const next = { ...row, ...op.changes };
              for (const name of op.removed) delete next[name];
              return next;
            },
          };
        };
        return b;
      },
      delete: (key: Row) => {
        const b = builder('review', key, {});
        const commit = b.commit;
        b.commit = () => {
          const op = commit();
          return {
            ...op,
            allowed: (row) => row !== undefined && op.allowed(row),
            apply: () => undefined,
          };
        };
        return b;
      },
    },
    enrolment: { check: checking('enrolment'), patch: patching('enrolment') },
    course: { check: checking('course') },
    courseRating: {
      update: (key: Row) => {
        const b = builder('courseRating', key, {});
        const commit = b.commit;
        b.commit = () => {
          const op = commit() as Operation & { changes: Row };
          return {
            ...op,
            apply: (row) => {
              const next: Row = { ...key, ...row };
              for (const [field, delta] of Object.entries(op.changes)) {
                next[field] = (next[field] ?? 0) + delta;
              }
              return next;
            },
          };
        };
        return b;
      },
    },
  };
};

const transact = (table: Table, operations: Operation[]) => {
  const keys = operations.map((o) => rowKey(o.entity, o.key));
  if (new Set(keys).size !== keys.length) {
    throw new Error(
      'Transaction request cannot include multiple operations on one item',
    );
  }
  const reasons = operations.map((o, i) => ({
    code: o.allowed(table.get(keys[i]!)) ? 'None' : 'ConditionalCheckFailed',
  }));
  if (reasons.some((r) => r.code !== 'None')) {
    throw new Cancelled(reasons);
  }
  operations.forEach((o, i) => {
    const next = o.apply(table.get(keys[i]!), table);
    if (next === undefined) table.delete(keys[i]!);
    else table.set(keys[i]!, next);
  });
};

const run = (table: Table, write: ReviewWrite) =>
  transact(
    table,
    reviewWrites(fakeEntities() as never, write) as unknown as Operation[],
  );

// Whether a transaction went through.
const succeeds = (table: Table, write: ReviewWrite) => {
  try {
    run(table, write);
    return true;
  } catch (error) {
    if (error instanceof Cancelled) return false;
    throw error;
  }
};

const AT = '2026-11-18T10:00:00.000Z';
const post = (userId: string, rating: number): ReviewWrite => ({
  action: 'post',
  courseId: 'c1',
  userId,
  at: AT,
  rating,
  reviewerName: reviewerName({ givenName: userId }),
});

const newTable = (students: string[]): Table => {
  const table: Table = new Map();
  table.set(rowKey('course', { courseId: 'c1' }), {
    courseId: 'c1',
    status: 'published',
  });
  for (const userId of students) {
    table.set(rowKey('enrolment', { courseId: 'c1', userId }), {
      courseId: 'c1',
      userId,
      status: 'active',
    });
  }
  return table;
};

const rows = (table: Table, entity: string) =>
  [...table.entries()]
    .filter(([key]) => key.startsWith(`${entity} `))
    .map(([, row]) => row);
const tally = (table: Table) =>
  rows(table, 'courseRating')[0] as Row | undefined;
const review = (table: Table, userId: string) =>
  table.get(rowKey('review', { courseId: 'c1', userId }));

// The three review invariants, run on the fake's table.
const violations = (table: Table) =>
  checkTableInvariants({
    courses: rows(table, 'course'),
    enrolments: rows(table, 'enrolment'),
    reviews: rows(table, 'review'),
    courseRatings: rows(table, 'courseRating'),
    modules: [],
    lessons: [],
    contentItems: [],
    courseInstructors: [],
    itemCompletions: [],
    progress: [],
    quizAttempts: [],
    quizSummaries: [],
    assignmentSubmissions: [],
    certificates: [],
    videoPositions: [],
    users: [],
    courseStats: [],
    periodStats: [],
    lessonStats: [],
    quizQuestionStats: [],
    quizScoreStats: [],
    notifications: [],
    notificationStates: [],
    notificationPreferences: [],
    notificationBroadcasts: [],
    announcements: [],
    categories: [],
    categoryClaims: [],
  } as unknown as TableSnapshot).filter((v) =>
    [
      'review-shape',
      'review-has-enrolment',
      'course-rating-matches-reviews',
    ].includes(v.invariant),
  );

describe('the fake', () => {
  it('rejects a transaction with two operations on one item', () => {
    const table = newTable(['a']);
    const twice = [
      ...(reviewWrites(fakeEntities() as never, {
        ...post('a', 3),
      }) as unknown as Operation[]),
    ];
    const counter = twice.find((o) => o.entity === 'courseRating')!;

    expect(() => transact(table, [...twice, counter])).toThrow(/multiple/);
  });

  it('refuses a hand-built transaction with two courseRating items', () => {
    const table = newTable(['a']);
    run(table, post('a', 4));
    const entities = fakeEntities();
    const decrement = entities.courseRating
      .update({ courseId: 'c1' })
      .add({ stars4: -1 })
      .commit();
    const increment = entities.courseRating
      .update({ courseId: 'c1' })
      .add({ stars2: 1 })
      .commit();

    expect(() => transact(table, [decrement, increment])).toThrow(/multiple/);
  });
});

describe('concurrent review writes', () => {
  it('lets a rating-changing edit through, moving one count', () => {
    const table = newTable(['a']);
    run(table, post('a', 4));

    expect(
      succeeds(table, {
        action: 'edit',
        courseId: 'c1',
        userId: 'a',
        at: AT,
        rating: 2,
        existing: { version: 1, rating: 4 },
      }),
    ).toBe(true);
    expect(tally(table)).toMatchObject({ stars4: 0, stars2: 1 });
    expect(review(table, 'a')).toMatchObject({ rating: 2, version: 2 });
    expect(violations(table)).toEqual([]);
  });

  it('lets exactly one of two posts by one student succeed', () => {
    const table = newTable(['a']);

    const results = [
      succeeds(table, post('a', 5)),
      succeeds(table, post('a', 1)),
    ];

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(tally(table)).toMatchObject({ stars5: 1 });
    expect(tally(table)?.stars1).toBeUndefined();
    expect(violations(table)).toEqual([]);
  });

  it('counts posts by five students', () => {
    const students = ['a', 'b', 'c', 'd', 'e'];
    const table = newTable(students);

    for (const userId of students) {
      expect(succeeds(table, post(userId, 3))).toBe(true);
    }

    expect(tally(table)).toMatchObject({ stars3: 5 });
    expect(violations(table)).toEqual([]);
  });

  it('refuses a post by a student who is not enrolled, or has dropped', () => {
    const table = newTable(['a']);
    table.get(rowKey('enrolment', { courseId: 'c1', userId: 'a' }))!.status =
      'dropped';

    expect(succeeds(table, post('a', 4))).toBe(false);
    expect(succeeds(table, post('stranger', 4))).toBe(false);
    expect(tally(table)).toBeUndefined();
  });

  it('refuses a post in a course that is not published', () => {
    const table = newTable(['a']);
    table.get(rowKey('course', { courseId: 'c1' }))!.status = 'archived';

    expect(succeeds(table, post('a', 4))).toBe(false);
  });

  it('lets exactly one of a post and a delete by one student succeed', () => {
    const table = newTable(['a']);
    const stale = {
      action: 'delete',
      courseId: 'c1',
      userId: 'a',
      at: AT,
      existing: { version: 1, rating: 4 },
    } as const;

    // The delete read nothing to delete, so it can only run after the post;
    // run the other way round, the post meets the deleted review and succeeds.
    expect(succeeds(table, stale)).toBe(false);
    expect(succeeds(table, post('a', 4))).toBe(true);
    expect(succeeds(table, stale)).toBe(true);
    expect(succeeds(table, post('a', 2))).toBe(true);
    expect(tally(table)).toMatchObject({ stars4: 0, stars2: 1 });
    expect(violations(table)).toEqual([]);
  });

  it('lets exactly one of two edits from one version succeed', () => {
    const table = newTable(['a']);
    run(table, post('a', 4));
    const edit = (rating: number): ReviewWrite => ({
      action: 'edit',
      courseId: 'c1',
      userId: 'a',
      at: AT,
      rating,
      existing: { version: 1, rating: 4 },
    });

    const results = [succeeds(table, edit(1)), succeeds(table, edit(5))];

    expect(results).toEqual([true, false]);
    expect(tally(table)).toMatchObject({ stars4: 0, stars1: 1 });
    expect(tally(table)?.stars5).toBeUndefined();
    expect(violations(table)).toEqual([]);
  });

  it('lets exactly one of an edit and a delete from one version succeed', () => {
    for (const order of [0, 1]) {
      const table = newTable(['a']);
      run(table, post('a', 4));
      const edit: ReviewWrite = {
        action: 'edit',
        courseId: 'c1',
        userId: 'a',
        at: AT,
        rating: 2,
        existing: { version: 1, rating: 4 },
      };
      const remove: ReviewWrite = {
        action: 'delete',
        courseId: 'c1',
        userId: 'a',
        at: AT,
        existing: { version: 1, rating: 4 },
      };

      const results = (order === 0 ? [edit, remove] : [remove, edit]).map((w) =>
        succeeds(table, w),
      );

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(violations(table)).toEqual([]);
    }
  });

  it('cancels a decrement of a counter at zero', () => {
    const table = newTable(['a']);
    run(table, post('a', 4));
    // The tally lost a count the review still has.
    tally(table)!.stars4 = 0;

    expect(
      succeeds(table, {
        action: 'delete',
        courseId: 'c1',
        userId: 'a',
        at: AT,
        existing: { version: 1, rating: 4 },
      }),
    ).toBe(false);
    expect(review(table, 'a')).toBeDefined();
    expect(tally(table)).toMatchObject({ stars4: 0 });
  });

  it('keeps the invariants through a mixed sequence', () => {
    const table = newTable(['a', 'b', 'c']);
    run(table, post('a', 5));
    run(table, post('b', 3));
    run(table, post('c', 3));
    run(table, {
      action: 'edit',
      courseId: 'c1',
      userId: 'b',
      at: AT,
      rating: 5,
      text: 'Better on a second look',
      existing: { version: 1, rating: 3 },
    });
    run(table, {
      action: 'delete',
      courseId: 'c1',
      userId: 'a',
      at: AT,
      existing: { version: 1, rating: 5 },
    });

    expect(tally(table)).toMatchObject({ stars3: 1, stars5: 1 });
    expect(review(table, 'b')).toMatchObject({
      rating: 5,
      text: 'Better on a second look',
      version: 2,
    });
    expect(violations(table)).toEqual([]);
  });
});
