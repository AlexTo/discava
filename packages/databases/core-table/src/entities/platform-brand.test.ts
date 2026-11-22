/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createCourseEntity } from './course.js';
import { createPaymentConnectionEntity } from './payment-connection.js';
import { createPlatformBrandEntity } from './platform-brand.js';

let brand: Awaited<ReturnType<typeof createPlatformBrandEntity>>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  brand = await createPlatformBrandEntity();
});

const record = {
  revision: 1,
  changedBy: 'admin-1',
  changedByName: 'Carol',
  changedAt: '2026-11-22T00:00:00.000Z',
};

describe('platformBrand', () => {
  it('is one record under a constant key', () => {
    const a = brand.create(record).params() as { Item: Record<string, string> };
    const b = brand.get({}).params() as { Key: Record<string, string> };
    expect(b.Key.pk).toBe(a.Item.pk);
    expect(b.Key.sk).toBe(a.Item.sk);
  });

  it('shows the name beside the logo unless told otherwise', () => {
    const { Item } = brand.create(record).params() as {
      Item: Record<string, unknown>;
    };
    expect(Item.showNameBesideLogo).toBe(true);
  });

  it('refuses a record without revision or changedBy', () => {
    for (const field of [
      'revision',
      'changedBy',
      'changedByName',
      'changedAt',
    ]) {
      const partial: Record<string, unknown> = { ...record };
      delete partial[field];
      expect(() => brand.create(partial as never).params()).toThrow();
    }
  });

  it('never has the key of another entity', async () => {
    const { Item } = brand.create(record).params() as {
      Item: Record<string, string>;
    };
    const connection = (
      (await createPaymentConnectionEntity())
        .create({ status: 'active', mode: 'test', revision: 1 })
        .params() as { Item: Record<string, string> }
    ).Item;
    const course = (
      (await createCourseEntity())
        .create({
          courseId: 'c',
          title: 't',
          certificatesEnabled: true,
          certificateCriteria: { version: 1, requireQuizPass: false },
          priceAmount: 0,
          priceCurrency: 'USD',
        })
        .params() as { Item: Record<string, string> }
    ).Item;
    for (const other of [connection, course]) {
      expect(`${other.pk}|${other.sk}`).not.toBe(`${Item.pk}|${Item.sk}`);
    }
    expect(Item.sk.startsWith('$platformbrand')).toBe(true);
  });
});
