/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createCertificateEntity } from './certificate.js';
import { createCourseEntity } from './course.js';
import { createEnrolmentEntity } from './enrolment.js';
import { createPayoutEntity } from './payout.js';

let payout: Awaited<ReturnType<typeof createPayoutEntity>>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  payout = await createPayoutEntity();
});

const full = {
  instructorId: 'instructor-1',
  payoutId: 'payout-1',
  accountId: 'acct_1',
  mode: 'test' as const,
  currency: 'USD',
  status: 'collecting' as const,
  amountMinor: 0,
  entryCount: 0,
  attemptedAt: '2026-11-19T00:00:00.000Z',
  connectedAccountId: 'acct_connected',
  createdAt: '2026-11-19T00:00:00.000Z',
};

type Params = { Item: Record<string, string> };

describe('payout', () => {
  it('accepts a complete record', () => {
    expect(() => payout.create(full).params()).not.toThrow();
  });

  it.each(Object.keys(full).filter((field) => field !== 'createdAt'))(
    'refuses a record without %s',
    (field) => {
      const record: Record<string, unknown> = { ...full };
      delete record[field];
      expect(() => payout.create(record as never).params()).toThrow();
    },
  );

  it('accepts each status and refuses any other, and any other mode', () => {
    for (const status of [
      'collecting',
      'pending',
      'sent',
      'failed',
      'releasing',
    ] as const) {
      expect(() => payout.create({ ...full, status }).params()).not.toThrow();
    }
    expect(() =>
      payout.create({ ...full, status: 'paid' as never }).params(),
    ).toThrow();
    expect(() =>
      payout.create({ ...full, mode: 'odd' as never }).params(),
    ).toThrow();
  });

  it.each(['amountMinor', 'entryCount'])(
    'refuses a non-integer %s',
    (field) => {
      expect(() =>
        payout.create({ ...full, [field]: 1.5 } as never).params(),
      ).toThrow();
    },
  );

  it("keys an instructor's payouts in time order", () => {
    const { Item } = payout.create(full).params() as Params;
    expect(Item.pk).toContain('instructor-1');
    expect(Item.sk).toBe('P#2026-11-19T00:00:00.000Z#payout-1');
  });

  it('queries payoutsByStatus on gsi1 with keys no other entity can equal', async () => {
    const params = payout.query
      .payoutsByStatus({ status: 'pending' })
      .params() as {
      IndexName: string;
      ExpressionAttributeValues: Record<string, string>;
    };
    expect(params.IndexName).toBe('gsi1pk-gsi1sk-index');
    const [queryKey] = Object.values(params.ExpressionAttributeValues);
    const { Item } = payout
      .create({ ...full, status: 'pending' })
      .params() as Params;
    expect(Item.gsi1pk).toBe(queryKey);

    const [enrolment, course, certificate] = await Promise.all([
      createEnrolmentEntity(),
      createCourseEntity(),
      createCertificateEntity(),
    ]);
    const others = [
      enrolment.create({ courseId: 'c', userId: 'u' }).params(),
      course
        .create({
          status: 'published',
          courseId: 'c',
          title: 't',
          certificatesEnabled: true,
          priceAmount: 0,
          priceCurrency: 'USD',
        })
        .params(),
      certificate
        .create({
          userId: 'u',
          courseId: 'c',
          certificateId: 'ABC',
          learnerName: 'n',
          courseTitle: 't',
          completedAt: 'x',
          issuedAt: 'x',
        })
        .params(),
    ] as Params[];
    for (const other of others) {
      expect(other.Item.gsi1pk).not.toBe(queryKey);
    }
  });
});
