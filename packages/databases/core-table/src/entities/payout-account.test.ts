/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createCertificateEntity } from './certificate.js';
import { createCourseInstructorEntity } from './course-instructor.js';
import { createEnrolmentEntity } from './enrolment.js';
import { createOrderEntity } from './order.js';
import { createPayoutAccountEntity } from './payout-account.js';

let payoutAccount: Awaited<ReturnType<typeof createPayoutAccountEntity>>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  payoutAccount = await createPayoutAccountEntity();
});

const full = {
  instructorId: 'instructor-1',
  accountId: 'acct_1',
  mode: 'test' as const,
  connectedAccountId: 'acct_connected',
  status: 'active' as const,
};

type Params = { Item: Record<string, string> };

describe('payoutAccount', () => {
  it('accepts a complete record', () => {
    expect(() => payoutAccount.create(full).params()).not.toThrow();
  });

  it.each(Object.keys(full))('refuses a record without %s', (field) => {
    const record: Record<string, unknown> = { ...full };
    delete record[field];
    expect(() => payoutAccount.create(record as never).params()).toThrow();
  });

  it('refuses a status or mode outside the set', () => {
    expect(() =>
      payoutAccount.create({ ...full, status: 'odd' as never }).params(),
    ).toThrow();
    expect(() =>
      payoutAccount.create({ ...full, mode: 'odd' as never }).params(),
    ).toThrow();
    for (const status of ['in_progress', 'active', 'restricted'] as const) {
      expect(() =>
        payoutAccount.create({ ...full, status }).params(),
      ).not.toThrow();
    }
  });

  it('keys by instructor, then payment account and mode', () => {
    const { Item } = payoutAccount.create(full).params() as Params;
    expect(Item.pk).toContain('instructor-1');
    expect(Item.sk).toContain('account#acct_1#test');
  });

  it('gives one instructor a record per payment account', () => {
    const keys = [
      full,
      { ...full, accountId: 'acct_2' },
      { ...full, mode: 'live' as const },
    ].map((record) => {
      const { Item } = payoutAccount.create(record).params() as Params;
      return `${Item.pk}|${Item.sk}`;
    });
    expect(new Set(keys).size).toBe(3);
  });

  it('queries byStatus on gsi1 with keys no other entity can equal', async () => {
    const params = payoutAccount.query
      .byStatus({ accountId: 'acct_1', mode: 'test', status: 'active' })
      .params() as {
      IndexName: string;
      ExpressionAttributeValues: Record<string, string>;
    };
    expect(params.IndexName).toBe('gsi1pk-gsi1sk-index');
    const [queryKey] = Object.values(params.ExpressionAttributeValues);
    const { Item } = payoutAccount.create(full).params() as Params;
    expect(Item.gsi1pk).toBe(queryKey);
    expect(Item.gsi1pk).toContain('acct_1');
    expect(Item.gsi1pk).toContain('active');

    const [enrolment, courseInstructor, order, certificate] = await Promise.all(
      [
        createEnrolmentEntity(),
        createCourseInstructorEntity(),
        createOrderEntity(),
        createCertificateEntity(),
      ],
    );
    const others = [
      enrolment.create({ courseId: 'c', userId: 'u' }).params(),
      courseInstructor
        .create({
          courseId: 'c',
          instructorId: 'u',
          courseUpdatedAt: '2026-11-19T00:00:00.000Z',
        })
        .params(),
      order
        .create({
          orderId: 'o',
          userId: 'u',
          courseId: 'c',
          accountId: 'acct_1',
          mode: 'test',
          courseTitle: 't',
          listAmount: 100,
          amount: 100,
          currency: 'USD',
          status: 'pending',
          expiresAt: 'x',
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
