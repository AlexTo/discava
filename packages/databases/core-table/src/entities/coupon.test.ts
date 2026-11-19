/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createCouponEntity } from './coupon.js';
import { createDiscussionVoteEntity } from './discussion-vote.js';

let coupon: Awaited<ReturnType<typeof createCouponEntity>>;
let vote: Awaited<ReturnType<typeof createDiscussionVoteEntity>>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  coupon = await createCouponEntity();
  vote = await createDiscussionVoteEntity();
});

const full = {
  courseId: 'course-1',
  code: 'SPRING-20',
  type: 'percent' as const,
  value: 20,
  createdBy: 'teacher-1',
};

describe('coupon', () => {
  it('accepts a complete record, counting from 0 and enabled', () => {
    const { Item } = coupon.create(full).params() as {
      Item: Record<string, unknown>;
    };
    expect(Item.redeemedCount).toBe(0);
    expect(Item.enabled).toBe(true);
  });

  it.each(Object.keys(full))('refuses a record without %s', (field) => {
    const record: Record<string, unknown> = { ...full };
    delete record[field];
    expect(() => coupon.create(record as never).params()).toThrow();
  });

  it('refuses a type that is neither percent nor fixed', () => {
    expect(() =>
      coupon.create({ ...full, type: 'bogus' as never }).params(),
    ).toThrow();
  });

  it('gets by course and code on the primary index', () => {
    const { Item } = coupon.create(full).params() as {
      Item: Record<string, string>;
    };
    const params = coupon
      .get({ courseId: 'course-1', code: 'SPRING-20' })
      .params() as { Key: Record<string, string> };
    expect(params.Key).toEqual({ pk: Item.pk, sk: Item.sk });
    expect(Item.pk).toContain('course-1');
    expect(Item.sk).toContain('spring-20');
  });

  it("lists a course's coupons by the primary index partition", () => {
    const params = coupon.query.primary({ courseId: 'course-1' }).params() as {
      KeyConditionExpression: string;
      ExpressionAttributeNames: Record<string, string>;
    };
    expect(Object.values(params.ExpressionAttributeNames)).toContain('pk');
  });

  it('has a key no other entity can equal', () => {
    const { Item } = coupon.create(full).params() as {
      Item: Record<string, string>;
    };
    const other = vote
      .create({
        courseId: 'course-1',
        userId: 'SPRING-20',
        lessonId: 'l',
        threadId: 't',
        postId: 'p',
      })
      .params() as { Item: Record<string, string> };
    expect(`${Item.pk}|${Item.sk}`).not.toBe(
      `${other.Item.pk}|${other.Item.sk}`,
    );
    expect(Item.sk.startsWith('$coupon_')).toBe(true);
  });
});
