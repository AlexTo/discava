/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createCertificateEntity } from './certificate.js';
import { createCourseInstructorEntity } from './course-instructor.js';
import { createEarningEntryEntity, openSettlement } from './earning-entry.js';
import { createEnrolmentEntity } from './enrolment.js';
import { createOrderEntity } from './order.js';

let entry: Awaited<ReturnType<typeof createEarningEntryEntity>>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  entry = await createEarningEntryEntity();
});

const full = {
  instructorId: 'instructor-1',
  courseId: 'course-1',
  orderId: 'order-1',
  accountId: 'acct_1',
  mode: 'test' as const,
  entryId: 'sale-order-1',
  kind: 'sale' as const,
  currency: 'USD',
  grossMinor: 1000,
  discountMinor: 200,
  refundMinor: 0,
  feeMinor: 160,
  netMinor: 640,
  feeBasisPoints: 2000,
  occurredAt: '2026-11-19T00:00:00.000Z',
  releaseAt: '2026-12-03T00:00:00.000Z',
};

type Params = { Item: Record<string, string> };
type UpdateParams = {
  UpdateExpression: string;
  ExpressionAttributeValues: Record<string, string>;
};

describe('earningEntry', () => {
  it('accepts a complete record, with no payout', () => {
    const { Item } = entry.create(full).params() as Params;
    expect(Item).not.toHaveProperty('payoutId');
  });

  it.each(Object.keys(full))('refuses a record without %s', (field) => {
    const record: Record<string, unknown> = { ...full };
    delete record[field];
    expect(() => entry.create(record as never).params()).toThrow();
  });

  it('refuses a kind or mode outside the set', () => {
    expect(() =>
      entry.create({ ...full, kind: 'gift' as never }).params(),
    ).toThrow();
    expect(() =>
      entry.create({ ...full, mode: 'odd' as never }).params(),
    ).toThrow();
    expect(() =>
      entry.create({ ...full, kind: 'refund' }).params(),
    ).not.toThrow();
  });

  it.each([
    'grossMinor',
    'discountMinor',
    'refundMinor',
    'feeMinor',
    'netMinor',
    'feeBasisPoints',
  ])('refuses a non-integer %s', (field) => {
    expect(() =>
      entry.create({ ...full, [field]: 1.5 } as never).params(),
    ).toThrow();
  });

  it('accepts negative fee and net, as a refund has', () => {
    expect(() =>
      entry
        .create({ ...full, kind: 'refund', feeMinor: -160, netMinor: -640 })
        .params(),
    ).not.toThrow();
  });

  it("keys a course's lines under the instructor in time order", () => {
    const { Item } = entry.create(full).params() as Params;
    expect(Item.pk).toContain('instructor-1');
    expect(Item.sk).toBe('L#course-1#2026-11-19T00:00:00.000Z#sale-order-1');
    const query = entry.query
      .primary({ instructorId: 'instructor-1' })
      .begins({ courseId: 'course-1' })
      .params() as { ExpressionAttributeValues: Record<string, string> };
    expect(Object.values(query.ExpressionAttributeValues)).toContain(
      'L#course-1',
    );
  });

  it('puts an entry with no payout under open#<instructorId> on gsi1', () => {
    const { Item } = entry.create(full).params() as Params;
    expect(Item.gsi1pk).toContain(openSettlement('instructor-1'));
    expect(Item.gsi1sk).toContain(full.releaseAt.toLowerCase());
  });

  it('moves the entry to payout#<payoutId> when payoutId is set', () => {
    const params = entry
      .patch({
        instructorId: 'instructor-1',
        courseId: 'course-1',
        occurredAt: full.occurredAt,
        entryId: full.entryId,
      })
      .set({ payoutId: 'payout-1' })
      .params() as UpdateParams;
    expect(Object.values(params.ExpressionAttributeValues)).toEqual(
      expect.arrayContaining([
        'payout-1',
        'payout#payout-1',
        expect.stringContaining('payout#payout-1'),
      ]),
    );
  });

  it('moves the entry back to open#<instructorId> when payoutId is cleared', () => {
    const params = entry
      .patch({
        instructorId: 'instructor-1',
        courseId: 'course-1',
        occurredAt: full.occurredAt,
        entryId: full.entryId,
      })
      .set({ settlement: openSettlement('instructor-1') })
      .remove(['payoutId'])
      .params() as UpdateParams;
    expect(params.UpdateExpression).toContain('REMOVE #payoutId');
    expect(Object.values(params.ExpressionAttributeValues)).toEqual(
      expect.arrayContaining([
        'open#instructor-1',
        expect.stringContaining('open#instructor-1'),
      ]),
    );
  });

  it('queries bySettlement on gsi1 with keys no other entity can equal', async () => {
    const params = entry.query
      .bySettlement({ settlement: openSettlement('instructor-1') })
      .params() as {
      IndexName: string;
      ExpressionAttributeValues: Record<string, string>;
    };
    expect(params.IndexName).toBe('gsi1pk-gsi1sk-index');
    const [queryKey] = Object.values(params.ExpressionAttributeValues);
    const { Item } = entry.create(full).params() as Params;
    expect(Item.gsi1pk).toBe(queryKey);

    const [enrolment, courseInstructor, order, certificate] = await Promise.all(
      [
        createEnrolmentEntity(),
        createCourseInstructorEntity(),
        createOrderEntity(),
        createCertificateEntity(),
      ],
    );
    const others = [
      enrolment.create({ courseId: 'c', userId: 'instructor-1' }).params(),
      courseInstructor
        .create({
          courseId: 'c',
          instructorId: 'instructor-1',
          courseUpdatedAt: 'x',
        })
        .params(),
      order
        .create({
          orderId: 'o',
          userId: 'instructor-1',
          courseId: 'c',
          accountId: 'a',
          mode: 'test',
          courseTitle: 't',
          listAmount: 1,
          amount: 1,
          currency: 'USD',
          status: 'pending',
          expiresAt: 'x',
        })
        .params(),
      certificate
        .create({
          userId: 'instructor-1',
          courseId: 'c',
          certificateId: 'ABC',
          learnerName: 'n',
          courseTitle: 't',
          completedAt: 'x',
          issuedAt: 'x',
          assessment: {
            criteriaVersion: 1,
            requireQuizPass: false,
            itemCount: 1,
            assessedItemCount: 0,
            assessedItems: [],
          },
        })
        .params(),
    ] as Params[];
    for (const other of others) {
      expect(other.Item.gsi1pk).not.toBe(queryKey);
    }
  });
});
