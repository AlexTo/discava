/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createCouponEntity } from './coupon.js';
import { createCouponRedemptionEntity } from './coupon-redemption.js';

let redemption: Awaited<ReturnType<typeof createCouponRedemptionEntity>>;
let coupon: Awaited<ReturnType<typeof createCouponEntity>>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  redemption = await createCouponRedemptionEntity();
  coupon = await createCouponEntity();
});

const full = {
  courseId: 'course-1',
  code: 'SPRING-20',
  userId: 'student-1',
  orderId: 'order-1',
  status: 'reserved' as const,
};

describe('couponRedemption', () => {
  it('accepts a complete record', () => {
    expect(() => redemption.create(full).params()).not.toThrow();
  });

  it.each(Object.keys(full))('refuses a record without %s', (field) => {
    const record: Record<string, unknown> = { ...full };
    delete record[field];
    expect(() => redemption.create(record as never).params()).toThrow();
  });

  it('refuses a status other than reserved or redeemed', () => {
    expect(() =>
      redemption.create({ ...full, status: 'paid' as never }).params(),
    ).toThrow();
  });

  it('gets by course, code and student on the primary index', () => {
    const { Item } = redemption.create(full).params() as {
      Item: Record<string, string>;
    };
    const params = redemption
      .get({ courseId: 'course-1', code: 'SPRING-20', userId: 'student-1' })
      .params() as { Key: Record<string, string> };
    expect(params.Key).toEqual({ pk: Item.pk, sk: Item.sk });
    expect(Item.pk).toContain('course-1');
    expect(Item.pk).toContain('spring-20');
    expect(Item.sk).toContain('student-1');
  });

  it("lists a code's redemptions by the primary index partition", () => {
    const { Item } = redemption.create(full).params() as {
      Item: Record<string, string>;
    };
    const params = redemption.query
      .primary({ courseId: 'course-1', code: 'SPRING-20' })
      .params() as { ExpressionAttributeValues: Record<string, string> };
    expect(Object.values(params.ExpressionAttributeValues)).toContain(Item.pk);
  });

  it("has keys no coupon's key can equal", () => {
    const { Item } = redemption.create(full).params() as {
      Item: Record<string, string>;
    };
    const { Item: couponItem } = coupon
      .create({
        courseId: 'course-1',
        code: 'SPRING-20',
        type: 'percent',
        value: 20,
        createdBy: 't',
      })
      .params() as { Item: Record<string, string> };
    expect(`${Item.pk}|${Item.sk}`).not.toBe(
      `${couponItem.pk}|${couponItem.sk}`,
    );
    expect(Item.sk.startsWith('$couponredemption_')).toBe(true);
  });
});
