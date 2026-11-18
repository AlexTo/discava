/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createCoreTableService } from '../service.js';
import {
  classifyReviewCancellation,
  type ReviewWrite,
  reviewerName,
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

  it.each(['edit', 'delete'] as const)(
    'an %s on a changed review, or one with no count to move, is stale',
    (action) => {
      expect(classifyReviewCancellation(action, [failed, none])).toBe('stale');
      expect(classifyReviewCancellation(action, [none, failed])).toBe('stale');
    },
  );

  it('names nothing when no condition failed', () => {
    const conflict = { code: 'TransactionConflict' };

    expect(
      classifyReviewCancellation('post', [conflict, none, none, none]),
    ).toBeUndefined();
    expect(classifyReviewCancellation('edit', [conflict])).toBeUndefined();
    expect(classifyReviewCancellation('delete', [])).toBeUndefined();
  });
});
