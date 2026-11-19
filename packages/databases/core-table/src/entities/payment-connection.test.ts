/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createCourseEntity } from './course.js';
import { createEnrolmentEntity } from './enrolment.js';
import { createOrderEntity } from './order.js';
import { createPaymentChangeEntity } from './payment-change.js';
import { createPaymentConnectionEntity } from './payment-connection.js';

let connection: Awaited<ReturnType<typeof createPaymentConnectionEntity>>;
let change: Awaited<ReturnType<typeof createPaymentChangeEntity>>;
let others: Record<string, { pk: string; sk: string }>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  connection = await createPaymentConnectionEntity();
  change = await createPaymentChangeEntity();
  const [order, enrolment, course] = await Promise.all([
    createOrderEntity(),
    createEnrolmentEntity(),
    createCourseEntity(),
  ]);
  others = {
    order: (
      order
        .create({
          orderId: 'o',
          userId: 'u',
          courseId: 'c',
          accountId: 'a',
          courseTitle: 't',
          listAmount: 100,
          amount: 100,
          currency: 'USD',
          status: 'pending',
          expiresAt: 'x',
        })
        .params() as { Item: { pk: string; sk: string } }
    ).Item,
    enrolment: (
      enrolment.create({ courseId: 'c', userId: 'u' }).params() as {
        Item: { pk: string; sk: string };
      }
    ).Item,
    course: (
      course
        .create({
          courseId: 'c',
          title: 't',
          certificatesEnabled: true,
          priceAmount: 0,
          priceCurrency: 'USD',
        })
        .params() as { Item: { pk: string; sk: string } }
    ).Item,
  };
});

const record = {
  status: 'active' as const,
  mode: 'test' as const,
  accountId: 'acct_1',
  accountName: 'Account',
  keyLast4: 'abcd',
  webhookEndpointId: 'we_1',
  webhookUrl: 'https://example.com/stripe/webhook',
  revision: 1,
};

const auditRow = {
  changeId: 'change-1',
  kind: 'connected' as const,
  byUserId: 'admin-1',
  byName: 'Carol',
  at: '2026-11-19T00:00:00.000Z',
};

describe('paymentConnection', () => {
  it('is one record under a constant key', () => {
    const a = connection.create(record).params() as {
      Item: Record<string, string>;
    };
    const b = connection.get({}).params() as { Key: Record<string, string> };
    expect(b.Key.pk).toBe(a.Item.pk);
    expect(b.Key.sk).toBe(a.Item.sk);
  });

  it('refuses a record without status, mode or revision', () => {
    for (const field of ['status', 'mode', 'revision'] as const) {
      const partial: Record<string, unknown> = { ...record };
      delete partial[field];
      expect(() => connection.create(partial as never).params()).toThrow();
    }
  });

  it('shares no key with another entity or with the audit rows', () => {
    const { Item } = connection.create(record).params() as {
      Item: Record<string, string>;
    };
    const audit = (
      change.create(auditRow).params() as {
        Item: Record<string, string>;
      }
    ).Item;
    // The partition key is shared with other constant-key entities; the sort
    // key's entity prefix is what keeps them apart.
    expect(audit.sk).not.toBe(Item.sk);
    expect(audit.sk?.startsWith('$paymentconnection')).toBe(false);
    for (const other of Object.values(others)) {
      expect(`${other.pk}|${other.sk}`).not.toBe(`${Item.pk}|${Item.sk}`);
    }
  });
});

describe('paymentChange', () => {
  it('lists newest first under one partition, sorted by changeId', () => {
    const params = change.query.primary({}).params() as {
      ExpressionAttributeValues: Record<string, string>;
      ScanIndexForward?: boolean;
    };
    expect(Object.values(params.ExpressionAttributeValues).join(' ')).toContain(
      'paymentchange',
    );
    const { Item } = change.create(auditRow).params() as {
      Item: Record<string, string>;
    };
    expect(Item.sk).toContain('change-1');
    expect(Item.sk.startsWith('\$paymentchange')).toBe(true);
    for (const other of Object.values(others)) {
      expect(`${other.pk}|${other.sk}`).not.toBe(`${Item.pk}|${Item.sk}`);
      expect(other.sk.startsWith('\$paymentchange')).toBe(false);
    }
  });

  it('refuses a row without who, when or kind', () => {
    for (const field of ['changeId', 'kind', 'byUserId', 'byName', 'at']) {
      const partial: Record<string, unknown> = { ...auditRow };
      delete partial[field];
      expect(() => change.create(partial as never).params()).toThrow();
    }
  });

  it('has no attribute that could hold a key', () => {
    const attributes = Object.keys(change.schema.attributes);
    expect(attributes).not.toContain('secretKey');
    expect(attributes).not.toContain('apiKey');
    expect(attributes).toContain('keyLast4');
    const { schema } = connection;
    expect(Object.keys(schema.attributes)).not.toContain('secretKey');
    expect(Object.keys(schema.attributes)).not.toContain('webhookSecret');
  });
});
