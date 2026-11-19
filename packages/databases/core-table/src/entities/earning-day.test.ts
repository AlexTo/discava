/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createEarningDayEntity } from './earning-day.js';

let day: Awaited<ReturnType<typeof createEarningDayEntity>>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  day = await createEarningDayEntity();
});

const full = {
  instructorId: 'instructor-1',
  courseId: 'course-1',
  currency: 'USD',
  day: '2026-11-19',
};

type Params = { Item: Record<string, string> };

describe('earningDay', () => {
  it('accepts a row with only its key', () => {
    expect(() => day.create(full).params()).not.toThrow();
  });

  it.each(Object.keys(full))('refuses a record without %s', (field) => {
    const record: Record<string, unknown> = { ...full };
    delete record[field];
    expect(() => day.create(record as never).params()).toThrow();
  });

  it('keys a day range under the instructor', () => {
    const { Item } = day.create(full).params() as Params;
    expect(Item.pk).toContain('instructor-1');
    expect(Item.sk).toBe('D#2026-11-19#course-1#USD');
  });
});
