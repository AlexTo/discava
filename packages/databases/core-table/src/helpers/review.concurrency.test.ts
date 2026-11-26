/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  Cancelled,
  createFakeTable,
  type Operation,
} from '../test-support/fake-transaction.js';
import {
  checkTableInvariants,
  emptyTableSnapshot,
} from './invariants/index.js';
import {
  type ReviewRespond,
  type ReviewWrite,
  reviewerName,
  reviewWrites,
} from './review.js';

// The fake transaction (test-support/fake-transaction.ts) over the entities
// reviewWrites builds its transaction from; a table is a Map of its rows.

type Row = Record<string, any>;
type Table = Map<string, Row>;

const KEY_FIELDS = {
  review: ['courseId', 'userId'],
  enrolment: ['courseId', 'userId'],
  course: ['courseId'],
  courseInstructor: ['courseId', 'instructorId'],
  courseRating: ['courseId'],
};
const keys = createFakeTable({ keyFields: KEY_FIELDS });
const rowKey = keys.keyOf;
const fakeEntities = () => keys.entities();
const transact = (table: Table, operations: Operation[]) =>
  createFakeTable({ keyFields: KEY_FIELDS, rows: table }).transact(operations);

const run = (table: Table, write: ReviewWrite) =>
  transact(
    table,
    reviewWrites(fakeEntities(), write) as unknown as Operation[],
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
  table.set(
    rowKey('courseInstructor', { courseId: 'c1', instructorId: 'i1' }),
    {
      courseId: 'c1',
      instructorId: 'i1',
    },
  );
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
    .filter(([key]) => key.startsWith(`${entity}|`))
    .map(([, row]) => row);
const tally = (table: Table) =>
  rows(table, 'courseRating')[0] as Row | undefined;
const review = (table: Table, userId: string) =>
  table.get(rowKey('review', { courseId: 'c1', userId }));

// The three review invariants, run on the fake's table.
const violations = (table: Table) =>
  checkTableInvariants({
    ...emptyTableSnapshot(),
    courses: rows(table, 'course'),
    enrolments: rows(table, 'enrolment'),
    reviews: rows(table, 'review'),
    courseRatings: rows(table, 'courseRating'),
    courseInstructors: rows(table, 'courseInstructor'),
  } as never).filter((v) =>
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
    const counter = twice.find((o) => o.key.startsWith('courseRating|'))!;

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

  describe('admin removal', () => {
    const removal = (version = 1, rating = 4): ReviewWrite => ({
      action: 'remove',
      courseId: 'c1',
      userId: 'a',
      at: AT,
      existing: { version, rating },
      removedBy: 'admin-1',
      reason: 'Abusive language',
    });
    const edit: ReviewWrite = {
      action: 'edit',
      courseId: 'c1',
      userId: 'a',
      at: AT,
      rating: 2,
      existing: { version: 1, rating: 4 },
    };

    it('marks the review removed and takes it out of the tally', () => {
      const table = newTable(['a']);
      run(table, post('a', 4));

      expect(succeeds(table, removal())).toBe(true);

      expect(review(table, 'a')).toMatchObject({
        status: 'removed',
        removedAt: AT,
        removedBy: 'admin-1',
        removedReason: 'Abusive language',
        rating: 4,
      });
      expect(tally(table)).toMatchObject({ stars4: 0 });
      expect(violations(table)).toEqual([]);
    });

    it('lets exactly one of an edit and a removal from one version succeed', () => {
      for (const order of [0, 1]) {
        const table = newTable(['a']);
        run(table, post('a', 4));

        const writes = order === 0 ? [edit, removal()] : [removal(), edit];
        const results = writes.map((w) => succeeds(table, w));

        expect(results.filter(Boolean)).toHaveLength(1);
        expect(violations(table)).toEqual([]);
      }
    });

    it('removes the edited review, and its new rating, when retried after a lost race', () => {
      const table = newTable(['a']);
      run(table, post('a', 4));
      run(table, edit);

      expect(succeeds(table, removal())).toBe(false);
      expect(succeeds(table, removal(2, 2))).toBe(true);

      expect(review(table, 'a')).toMatchObject({
        status: 'removed',
        rating: 2,
        version: 2,
      });
      expect(tally(table)).toMatchObject({ stars4: 0, stars2: 0 });
      expect(violations(table)).toEqual([]);
    });

    it('cancels a post by the same student afterwards', () => {
      const table = newTable(['a']);
      run(table, post('a', 4));
      run(table, removal());

      expect(succeeds(table, post('a', 5))).toBe(false);
      expect(review(table, 'a')).toMatchObject({ status: 'removed' });
      expect(tally(table)?.stars5).toBeUndefined();
      expect(violations(table)).toEqual([]);
    });

    it('decrements once for a double removal', () => {
      const table = newTable(['a', 'b']);
      run(table, post('a', 4));
      run(table, post('b', 4));

      expect(succeeds(table, removal())).toBe(true);
      expect(succeeds(table, removal())).toBe(false);

      expect(tally(table)).toMatchObject({ stars4: 1 });
      expect(violations(table)).toEqual([]);
    });

    it('refuses a student edit or delete of a removed review', () => {
      const table = newTable(['a']);
      run(table, post('a', 4));
      run(table, removal());

      expect(succeeds(table, edit)).toBe(false);
      expect(
        succeeds(table, {
          action: 'delete',
          courseId: 'c1',
          userId: 'a',
          at: AT,
          existing: { version: 1, rating: 4 },
        }),
      ).toBe(false);
      expect(review(table, 'a')).toMatchObject({ status: 'removed' });
    });
  });

  describe('instructor responses', () => {
    const respond = (text = 'Thank you'): ReviewRespond => ({
      action: 'respond',
      courseId: 'c1',
      userId: 'a',
      at: AT,
      instructorId: 'i1',
      instructorName: 'Sam L.',
      text,
    });
    const clear: ReviewWrite = {
      action: 'deleteResponse',
      courseId: 'c1',
      userId: 'a',
      at: AT,
      instructorId: 'i1',
    };
    const edit: ReviewWrite = {
      action: 'edit',
      courseId: 'c1',
      userId: 'a',
      at: AT,
      rating: 2,
      existing: { version: 1, rating: 4 },
    };

    it('answers a review without touching its version or the tally', () => {
      const table = newTable(['a']);
      run(table, post('a', 4));

      expect(succeeds(table, respond())).toBe(true);

      expect(review(table, 'a')).toMatchObject({
        rating: 4,
        version: 1,
        responseText: 'Thank you',
        responseById: 'i1',
        responseByName: 'Sam L.',
      });
      expect(tally(table)).toMatchObject({ stars4: 1 });
      expect(violations(table)).toEqual([]);
    });

    it('lets a student edit from the version it read after a response', () => {
      const table = newTable(['a']);
      run(table, post('a', 4));
      run(table, respond());

      expect(succeeds(table, edit)).toBe(true);

      expect(review(table, 'a')).toMatchObject({
        rating: 2,
        version: 2,
        responseText: 'Thank you',
      });
      expect(tally(table)).toMatchObject({ stars4: 0, stars2: 1 });
      expect(violations(table)).toEqual([]);
    });

    it('replaces an answer and clears it, twice over without harm', () => {
      const table = newTable(['a']);
      run(table, post('a', 4));
      run(table, respond('First'));
      run(table, respond('Second'));
      expect(review(table, 'a')).toMatchObject({ responseText: 'Second' });

      expect(succeeds(table, clear)).toBe(true);
      expect(succeeds(table, clear)).toBe(true);
      expect(review(table, 'a')).not.toHaveProperty('responseText');
      expect(review(table, 'a')).not.toHaveProperty('responseById');
      expect(violations(table)).toEqual([]);
    });

    it('refuses an answer to a removed or missing review', () => {
      const table = newTable(['a']);
      expect(succeeds(table, respond())).toBe(false);

      run(table, post('a', 4));
      review(table, 'a')!.status = 'removed';
      expect(succeeds(table, respond())).toBe(false);
      expect(review(table, 'a')).not.toHaveProperty('responseText');
    });

    it('refuses an answer from someone who does not teach the course', () => {
      const table = newTable(['a']);
      run(table, post('a', 4));

      expect(succeeds(table, { ...respond(), instructorId: 'other' })).toBe(
        false,
      );
    });
  });
});
