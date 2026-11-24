/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createCourseEntity } from './course.js';
import { createEnrolmentEntity } from './enrolment.js';
import { createOrderEntity } from './order.js';

let order: Awaited<ReturnType<typeof createOrderEntity>>;
let enrolment: Awaited<ReturnType<typeof createEnrolmentEntity>>;
let course: Awaited<ReturnType<typeof createCourseEntity>>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  order = await createOrderEntity();
  enrolment = await createEnrolmentEntity();
  course = await createCourseEntity();
});

const full = {
  orderId: 'order-1',
  userId: 'user-1',
  courseId: 'course-1',
  accountId: 'acct_1',
  mode: 'test' as const,
  courseTitle: 'Intro',
  listAmount: 1999,
  amount: 1999,
  currency: 'USD',
  status: 'pending' as const,
  expiresAt: '2026-11-19T01:00:00.000Z',
};

describe('order', () => {
  it('accepts a complete record, with the optional attributes absent', () => {
    const { Item } = order.create(full).params() as {
      Item: Record<string, unknown>;
    };
    for (const optional of [
      'checkoutSessionId',
      'checkoutUrl',
      'paymentIntentId',
      'paidAt',
      'refundedAt',
      'refundedAmount',
      'refundReason',
    ]) {
      expect(Item).not.toHaveProperty(optional);
    }
  });

  it.each(Object.keys(full))('refuses a record without %s', (field) => {
    const record: Record<string, unknown> = { ...full };
    delete record[field];
    expect(() => order.create(record as never).params()).toThrow();
  });

  const coupon = {
    discountAmount: 500,
    couponCode: 'SPRING-20',
    couponType: 'fixed' as const,
    couponValue: 500,
  };

  it('accepts a whole coupon snapshot and refuses a partial one', () => {
    expect(() => order.create({ ...full, ...coupon }).params()).not.toThrow();
    for (const field of Object.keys(coupon)) {
      const partial: Record<string, unknown> = { ...full, ...coupon };
      delete partial[field];
      expect(() => order.create(partial as never).params()).toThrow();
    }
    expect(() =>
      order.create({ ...full, couponCode: 'SPRING-20' }).params(),
    ).toThrow();
  });

  it('refuses a mode other than test or live', () => {
    expect(() =>
      order.create({ ...full, mode: 'sandbox' as never }).params(),
    ).toThrow();
    for (const mode of ['test', 'live'] as const) {
      expect(() => order.create({ ...full, mode }).params()).not.toThrow();
    }
  });

  it.each(['pending', 'paid', 'expired', 'refunded'] as const)(
    'accepts status %s',
    (status) => {
      expect(() => order.create({ ...full, status }).params()).not.toThrow();
    },
  );

  it.each(['requested', 'duplicate', 'unavailable', 'mismatch'] as const)(
    'accepts refund reason %s and refuses an unknown one',
    (refundReason) => {
      expect(() =>
        order.create({ ...full, refundReason }).params(),
      ).not.toThrow();
      expect(() =>
        order.create({ ...full, refundReason: 'other' as never }).params(),
      ).toThrow();
    },
  );

  it('keys the primary index by order alone', () => {
    const { Key } = order.get({ orderId: 'order-1' }).params() as {
      Key: Record<string, string>;
    };
    expect(Key.pk).toContain('order-1');
  });

  it('queries byStudentCourse on gsi1 with a key no enrolment or course key can equal', () => {
    const params = order.query
      .byStudentCourse({ userId: 'user-1', courseId: 'course-1' })
      .params() as {
      IndexName: string;
      ExpressionAttributeValues: Record<string, string>;
    };
    expect(params.IndexName).toBe('gsi1pk-gsi1sk-index');
    // The partition is the student's, shared with their enrolments through
    // gsi1; what keeps the two apart is the sort key's entity prefix.
    const [, sortKey] = Object.values(params.ExpressionAttributeValues);
    expect(sortKey).toMatch(/^\$order_1#courseid_course-1/);

    const { Item: enrolmentItem } = enrolment
      .create({ courseId: 'course-1', userId: 'user-1' })
      .params() as { Item: Record<string, string> };
    const { Item: courseItem } = course
      .create({
        courseId: 'course-1',
        title: 'x',
        certificatesEnabled: true,
        certificateCriteria: { version: 1, requireQuizPass: false },
        priceAmount: 0,
        priceCurrency: 'USD',
      })
      .params() as { Item: Record<string, string> };
    expect(enrolmentItem.gsi1sk?.startsWith(sortKey as string)).toBe(false);
    expect(courseItem.gsi1sk?.startsWith(sortKey as string)).toBe(false);

    const { Item } = order.create(full).params() as {
      Item: Record<string, string>;
    };
    expect(Item.gsi1sk?.startsWith(sortKey as string)).toBe(true);
    expect(Item.gsi1sk).not.toBe(enrolmentItem.gsi1sk);
  });

  it('keeps the order id out of every enrolment key', () => {
    const { Item } = enrolment
      .create({ courseId: 'course-1', userId: 'user-1', orderId: 'order-1' })
      .params() as { Item: Record<string, string> };
    expect(Item.orderId).toBe('order-1');
    for (const key of [Item.pk, Item.sk, Item.gsi1pk, Item.gsi1sk]) {
      expect(key).not.toContain('order-1');
    }
  });
});
