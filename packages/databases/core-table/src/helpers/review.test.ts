/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createCoreTableService } from '../service.js';
import { buildNotification } from './notification-types.js';
import {
  classifyReviewCancellation,
  MAX_REVIEW_NOTIFIED_INSTRUCTORS,
  type ReviewWrite,
  responseText,
  reviewerName,
  reviewNotifications,
  reviewText,
  reviewWrites,
} from './review.js';

// The requests ElectroDB would send, checked without a table.

let coreTable: Awaited<ReturnType<typeof createCoreTableService>>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  coreTable = await createCoreTableService();
});

describe('reviewerName', () => {
  it.each([
    ['both names', { givenName: 'Alex', familyName: 'To' }, 'Alex T.'],
    ['a given name only', { givenName: 'Alex' }, 'Alex'],
    ['a family name only', { familyName: 'To' }, 'T.'],
    ['neither', {}, 'Discava learner'],
    ['nobody', undefined, 'Discava learner'],
    ['null names', { givenName: null, familyName: null }, 'Discava learner'],
    [
      'whitespace only',
      { givenName: '  ', familyName: ' \t' },
      'Discava learner',
    ],
    [
      'a lowercase family name',
      { givenName: ' Alex ', familyName: ' to' },
      'Alex T.',
    ],
    [
      'a non-Latin family name',
      { givenName: 'Wei', familyName: '王' },
      'Wei 王.',
    ],
    ['a surrogate pair', { givenName: 'Wei', familyName: '𠮷田' }, 'Wei 𠮷.'],
  ])('shows %s', (_, user, expected) => {
    expect(reviewerName(user)).toBe(expected);
  });

  it('never uses the email', () => {
    expect(reviewerName({ email: 'alex@example.com' } as never)).toBe(
      'Discava learner',
    );
  });
});

describe('reviewText', () => {
  it('trims, and stores nothing for whitespace', () => {
    expect(reviewText('  great course \n')).toBe('great course');
    expect(reviewText('  \n\t ')).toBeUndefined();
    expect(reviewText('')).toBeUndefined();
    expect(reviewText(undefined)).toBeUndefined();
  });

  it('counts the trimmed text towards the limit', () => {
    expect(reviewText(` ${'a'.repeat(2000)} `)).toHaveLength(2000);
    expect(() => reviewText('a'.repeat(2001))).toThrow(RangeError);
  });
});

interface Conditional {
  ConditionExpression?: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
}

interface TransactItem {
  ConditionCheck?: Conditional & { Key: Record<string, string> };
  Update?: Conditional & {
    UpdateExpression: string;
    Key: Record<string, string>;
  };
  Put?: Conditional & { Item: Record<string, unknown> };
  Delete?: Conditional & { Key: Record<string, string> };
}

const AT = '2026-11-18T10:00:00.000Z';
const base = { courseId: 'course-1', userId: 'student-1', at: AT };
const post: ReviewWrite = {
  ...base,
  action: 'post',
  reviewerName: 'Alex T.',
  rating: 4,
  text: 'Clear and well paced.',
};
const edit: ReviewWrite = {
  ...base,
  action: 'edit',
  rating: 4,
  text: 'Still good.',
  existing: { version: 2, rating: 4 },
};
const remove: ReviewWrite = {
  ...base,
  action: 'delete',
  existing: { version: 2, rating: 4 },
};

const itemsFor = (write: ReviewWrite): TransactItem[] =>
  coreTable.transaction
    .write((entities) => reviewWrites(entities, write))
    .params().TransactItems;

const requestOf = (item: TransactItem) =>
  (item.ConditionCheck ??
    item.Update ??
    item.Put ??
    item.Delete) as Conditional;

const resolve = (request: Conditional, expression = '') =>
  expression.replace(
    /#\w+|:\w+/g,
    (token) =>
      `${request.ExpressionAttributeNames[token] ?? request.ExpressionAttributeValues[token] ?? token}`,
  );

const conditionOf = (item: TransactItem) => {
  const request = requestOf(item);
  return resolve(request, request.ConditionExpression);
};

const updateOf = (item: TransactItem) =>
  resolve(requestOf(item), item.Update?.UpdateExpression);

// DynamoDB rejects a transaction with two operations on one item.
const keysOf = (items: TransactItem[]) =>
  items.map((item) => {
    const op = item.ConditionCheck ?? item.Update ?? item.Delete;
    return JSON.stringify(
      op ? op.Key : { pk: item.Put?.Item.pk, sk: item.Put?.Item.sk },
    );
  });

describe('a post', () => {
  it('creates the review, checks enrolment and course, and counts the rating', () => {
    const items = itemsFor(post);

    expect(items).toHaveLength(4);
    expect(items[0]!.Put?.Item).toMatchObject({
      courseId: 'course-1',
      userId: 'student-1',
      rating: 4,
      text: 'Clear and well paced.',
      reviewerName: 'Alex T.',
      status: 'visible',
      version: 1,
      createdAt: AT,
    });
    expect(conditionOf(items[0]!)).toContain('attribute_not_exists');
    expect(conditionOf(items[1]!)).toContain('attribute_exists(userId)');
    expect(conditionOf(items[1]!)).toContain('status <> dropped');
    expect(conditionOf(items[2]!)).toContain('status = published');
    expect(updateOf(items[3]!)).toMatch(/ADD .*stars4 1/);
    expect(updateOf(items[3]!)).not.toMatch(/stars[^4]/);
  });

  it('stores a rating-only review with no text', () => {
    const items = itemsFor({ ...post, text: undefined });
    expect(items[0]!.Put?.Item).not.toHaveProperty('text');

    const blank = itemsFor({ ...post, text: '   ' });
    expect(blank[0]!.Put?.Item).not.toHaveProperty('text');
  });

  it('trims the text', () => {
    expect(
      itemsFor({ ...post, text: '  Good \n' })[0]!.Put?.Item,
    ).toMatchObject({ text: 'Good' });
  });

  it('adds to the counter of each rating', () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(updateOf(itemsFor({ ...post, rating })[3]!)).toContain(
        `stars${rating} 1`,
      );
    }
  });

  it('refuses a rating the tally has no counter for', () => {
    expect(() => itemsFor({ ...post, rating: 6 })).toThrow();
    expect(() => itemsFor({ ...post, rating: 3.5 })).toThrow();
  });

  it('writes no two items for one key', () => {
    const keys = keysOf(itemsFor(post));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// No notification state yet for any instructor, so no table is read.
const notify = (instructorIds: string[]) =>
  reviewNotifications(coreTable, {
    courseId: 'course-1',
    courseTitle: 'Intro to Rust',
    studentId: 'student-1',
    rating: 4,
    createdAt: AT,
    instructorIds,
  });

describe('a post with notifications', () => {
  beforeAll(() => {
    vi.spyOn(coreTable.entities.notificationState, 'get').mockReturnValue({
      go: async () => ({ data: undefined }),
    } as never);
  });

  it('adds a notification and unread count for each instructor after the tally', async () => {
    const notifications = await notify(['teacher-1', 'teacher-2']);
    const items = itemsFor({ ...post, notifications } as ReviewWrite);

    expect(notifications).toHaveLength(4);
    expect(items).toHaveLength(8);
    const created = items.filter(
      (item) => item.Put?.Item.type === 'review.received',
    );
    expect(created.map((item) => item.Put?.Item.userId)).toEqual([
      'teacher-1',
      'teacher-2',
    ]);
    expect(created[0]!.Put?.Item).toMatchObject({
      occurredAt: AT,
      title: 'New review for Intro to Rust',
      link: { portal: 'instructor', path: '/my-courses/course-1/reviews' },
    });
    expect(conditionOf(created[0]!)).toContain('attribute_not_exists');
    const keys = keysOf(items);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('takes its params from a registered type and the rating as a string', () => {
    expect(() =>
      buildNotification('review.received', {
        courseId: 'course-1',
        courseTitle: 'Intro to Rust',
        rating: '4',
      }),
    ).not.toThrow();
  });

  it('uses the same notification id for the same student and course', async () => {
    const notifications = await notify(['teacher-1']);
    const again = await notify(['teacher-1']);
    const sk = (items: typeof notifications) =>
      (
        coreTable.transaction.write(() => items).params()
          .TransactItems as TransactItem[]
      )[0]!.Put?.Item.sk;
    expect(sk(notifications)).toBe(sk(again));
  });

  it('posts without notification items for a course with no instructor', async () => {
    expect(await notify([])).toEqual([]);
    expect(
      itemsFor({ ...post, notifications: [] } as ReviewWrite),
    ).toHaveLength(4);
  });

  it('notifies each instructor once and no more than a transaction holds', async () => {
    const many = Array.from({ length: 150 }, (_, i) => `teacher-${i % 120}`);
    const notifications = await notify(many);
    const items = itemsFor({ ...post, notifications } as ReviewWrite);

    expect(notifications).toHaveLength(MAX_REVIEW_NOTIFIED_INSTRUCTORS * 2);
    expect(items.length).toBeLessThanOrEqual(100);
  });

  it.each([
    ['an edit', edit],
    ['a delete', remove],
    ['a response', respond],
    ['a response deleted', deleteResponse],
  ])('%s adds no notification items', (_, write) => {
    expect(
      itemsFor(write).some((item) => item.Put?.Item.type === 'review.received'),
    ).toBe(false);
  });
});

describe('an edit', () => {
  it('patches the review under the version it read, while visible', () => {
    const items = itemsFor(edit);
    const [patch] = items;

    expect(items).toHaveLength(1);
    expect(updateOf(patch!)).toContain('rating = 4');
    expect(updateOf(patch!)).toContain('text = Still good.');
    expect(updateOf(patch!)).toContain(`editedAt = ${AT}`);
    expect(updateOf(patch!)).toContain('version = 3');
    expect(conditionOf(patch!)).toContain('version = 2');
    expect(conditionOf(patch!)).toContain('status = visible');
  });

  it('writes no counter when the rating is unchanged', () => {
    const items = itemsFor(edit);

    expect(items.some((item) => updateOf(item).includes('stars'))).toBe(false);
  });

  it('writes exactly one counter item when the rating changes', () => {
    const items = itemsFor({ ...edit, rating: 2 });
    const counters = items.filter((item) => updateOf(item).includes('stars'));

    expect(items).toHaveLength(2);
    expect(counters).toHaveLength(1);
    expect(updateOf(counters[0]!)).toMatch(/ADD .*stars4 -1/);
    expect(updateOf(counters[0]!)).toMatch(/ADD .*stars2 1/);
    expect(conditionOf(counters[0]!)).toContain('stars4 >= 1');
    const keys = keysOf(items);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('removes the text when the new text is blank', () => {
    const [patch] = itemsFor({ ...edit, text: '  ' });

    expect(updateOf(patch!)).toMatch(/REMOVE .*text/);
    expect(updateOf(patch!)).not.toContain('text =');
  });

  it('trims the text', () => {
    expect(updateOf(itemsFor({ ...edit, text: ' Fine ' })[0]!)).toContain(
      'text = Fine',
    );
  });
});

describe('a delete', () => {
  it('deletes the review it read and takes one off its counter', () => {
    const [review, counter, ...rest] = itemsFor(remove);

    expect(rest).toEqual([]);
    expect(review!.Delete).toBeDefined();
    expect(conditionOf(review!)).toContain('version = 2');
    expect(conditionOf(review!)).toContain('status = visible');
    expect(updateOf(counter!)).toMatch(/ADD .*stars4 -1/);
    expect(conditionOf(counter!)).toContain('stars4 >= 1');
  });

  it('writes no two items for one key', () => {
    const keys = keysOf(itemsFor(remove));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('a removal', () => {
  const removal: ReviewWrite = {
    ...base,
    action: 'remove',
    existing: { version: 2, rating: 4 },
    removedBy: 'admin-1',
    reason: '  Abusive language  ',
  };

  it('marks the review removed under the version it read, and takes one off its counter', () => {
    const [review, counter, ...rest] = itemsFor(removal);

    expect(rest).toEqual([]);
    expect(updateOf(review!)).toContain('status = removed');
    expect(updateOf(review!)).toContain(`removedAt = ${AT}`);
    expect(updateOf(review!)).toContain('removedBy = admin-1');
    expect(updateOf(review!)).toContain('removedReason = Abusive language');
    expect(updateOf(review!)).not.toContain('version =');
    expect(conditionOf(review!)).toContain('version = 2');
    expect(conditionOf(review!)).toContain('status = visible');
    expect(updateOf(counter!)).toMatch(/ADD .*stars4 -1/);
    expect(conditionOf(counter!)).toContain('stars4 >= 1');
  });

  it('refuses an empty or over-long reason', () => {
    expect(() => itemsFor({ ...removal, reason: '  ' } as ReviewWrite)).toThrow(
      RangeError,
    );
    expect(() =>
      itemsFor({ ...removal, reason: 'x'.repeat(201) } as ReviewWrite),
    ).toThrow(RangeError);
    expect(() =>
      itemsFor({ ...removal, reason: 'x'.repeat(200) } as ReviewWrite),
    ).not.toThrow();
  });

  it('writes no two items for one key', () => {
    const keys = keysOf(itemsFor(removal));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

const respond: ReviewWrite = {
  ...base,
  action: 'respond',
  instructorId: 'instructor-1',
  instructorName: 'Sam L.',
  text: '  Thanks for the feedback!  ',
};
const deleteResponse: ReviewWrite = {
  ...base,
  action: 'deleteResponse',
  instructorId: 'instructor-1',
};

describe('responseText', () => {
  it('trims, and refuses nothing or too much', () => {
    expect(responseText('  Thanks \n')).toBe('Thanks');
    expect(responseText(` ${'a'.repeat(1000)} `)).toHaveLength(1000);
    expect(() => responseText('   ')).toThrow(RangeError);
    expect(() => responseText('a'.repeat(1001))).toThrow(RangeError);
  });
});

describe('a response', () => {
  it('sets the four response attributes on a visible review', () => {
    const items = itemsFor(respond);
    const [patch] = items;

    expect(items).toHaveLength(2);
    expect(updateOf(patch!)).toContain(
      'responseText = Thanks for the feedback!',
    );
    expect(updateOf(patch!)).toContain(`responseAt = ${AT}`);
    expect(updateOf(patch!)).toContain('responseById = instructor-1');
    expect(updateOf(patch!)).toContain('responseByName = Sam L.');
    expect(conditionOf(patch!)).toContain('status = visible');
  });

  it('leaves the version, edit time, rating and tally alone', () => {
    const items = itemsFor(respond);
    const update = updateOf(items[0]!);

    for (const name of ['version', 'editedAt', 'rating', 'text =', 'stars']) {
      expect(update).not.toContain(name);
    }
    expect(conditionOf(items[0]!)).not.toContain('version');
    expect(items.some((item) => updateOf(item).includes('stars'))).toBe(false);
  });

  it('checks the instructor still teaches the course', () => {
    const check = itemsFor(respond)[1]!;

    expect(check.ConditionCheck).toBeDefined();
    expect(conditionOf(check)).toContain('attribute_exists(instructorId)');
    expect(JSON.stringify(check.ConditionCheck!.Key)).toContain('course-1');
  });

  it('refuses empty or over-long text', () => {
    expect(() => itemsFor({ ...respond, text: ' ' } as ReviewWrite)).toThrow();
    expect(() =>
      itemsFor({ ...respond, text: 'a'.repeat(1001) } as ReviewWrite),
    ).toThrow();
  });

  it('writes no two items for one key', () => {
    const keys = keysOf(itemsFor(respond));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('deleting a response', () => {
  it('removes the four attributes under the same conditions, with no counter', () => {
    const items = itemsFor(deleteResponse);
    const update = updateOf(items[0]!);

    expect(items).toHaveLength(2);
    expect(update).toMatch(/REMOVE/);
    for (const name of [
      'responseText',
      'responseAt',
      'responseById',
      'responseByName',
    ]) {
      expect(update).toContain(name);
    }
    expect(update).not.toContain('stars');
    expect(conditionOf(items[0]!)).toContain('status = visible');
    expect(conditionOf(items[1]!)).toContain('attribute_exists(instructorId)');
  });
});

describe('classifyReviewCancellation', () => {
  const failed = { code: 'ConditionalCheckFailed' };
  const none = { code: 'None' };

  it.each([
    ['the review exists', [failed, none, none, none], 'already-reviewed'],
    ['the student is not enrolled', [none, failed, none, none], 'not-enrolled'],
    ['the course is not open', [none, none, failed, none], 'course-closed'],
  ])('a post cancelled because %s', (_, reasons, expected) => {
    expect(classifyReviewCancellation('post', reasons)).toBe(expected);
  });

  it.each(['edit', 'delete', 'remove'] as const)(
    'an %s on a changed review, or one with no count to move, is stale',
    (action) => {
      expect(classifyReviewCancellation(action, [failed, none])).toBe('stale');
      expect(classifyReviewCancellation(action, [none, failed])).toBe('stale');
    },
  );

  it.each(['respond', 'deleteResponse'] as const)(
    'a %s on a missing or removed review is unavailable',
    (action) => {
      expect(classifyReviewCancellation(action, [failed, none])).toBe(
        'unavailable',
      );
    },
  );

  it.each(['respond', 'deleteResponse'] as const)(
    'a %s by someone who no longer teaches the course is refused',
    (action) => {
      expect(classifyReviewCancellation(action, [none, failed])).toBe(
        'not-instructor',
      );
    },
  );

  it('names nothing when no condition failed', () => {
    const conflict = { code: 'TransactionConflict' };

    expect(
      classifyReviewCancellation('post', [conflict, none, none, none]),
    ).toBeUndefined();
    expect(classifyReviewCancellation('edit', [conflict])).toBeUndefined();
    expect(classifyReviewCancellation('delete', [])).toBeUndefined();
    expect(
      classifyReviewCancellation('respond', [conflict, none]),
    ).toBeUndefined();
  });
});
