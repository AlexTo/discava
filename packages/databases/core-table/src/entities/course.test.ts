/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CERTIFICATE_CRITERIA } from '../helpers/certificate-criteria.js';
import { createCourseEntity } from './course.js';

// The requests ElectroDB would send, checked without a table.

let course: Awaited<ReturnType<typeof createCourseEntity>>;
beforeAll(async () => {
  course = await createCourseEntity();
});

const record = {
  courseId: 'course-1',
  title: 'A course',
  certificatesEnabled: true,
  priceAmount: 0,
  priceCurrency: 'USD',
  certificateCriteria: DEFAULT_CERTIFICATE_CRITERIA,
};

describe('course', () => {
  it.each(['priceAmount', 'priceCurrency'] as const)(
    'refuses a record without %s',
    (attribute) => {
      const { [attribute]: _omitted, ...rest } = record;
      expect(() => course.create(rest as typeof record).params()).toThrow(
        attribute,
      );
    },
  );

  it('keeps pricedAt optional', () => {
    const { Item } = course.create(record).params() as {
      Item: Record<string, unknown>;
    };
    expect(Item).not.toHaveProperty('pricedAt');
    expect(Item.priceAmount).toBe(0);
  });

  it('accepts a record with and without firstLessonPrompt', () => {
    const without = course.create(record).params() as {
      Item: Record<string, unknown>;
    };
    expect(without.Item).not.toHaveProperty('firstLessonPrompt');
    const { Item } = course
      .create({ ...record, firstLessonPrompt: 'What is your goal?' })
      .params() as { Item: Record<string, unknown> };
    expect(Item.firstLessonPrompt).toBe('What is your goal?');
  });

  it('round-trips learningOutcomes and requirements', () => {
    const { Item } = course
      .create({
        ...record,
        learningOutcomes: ['Build an API', 'Deploy it'],
        requirements: ['A laptop'],
      })
      .params() as { Item: Record<string, unknown> };

    expect(Item.learningOutcomes).toEqual(['Build an API', 'Deploy it']);
    expect(Item.requirements).toEqual(['A laptop']);
  });

  it('is created without them', () => {
    const { Item } = course.create(record).params() as {
      Item: Record<string, unknown>;
    };

    expect(Item).not.toHaveProperty('learningOutcomes');
    expect(Item).not.toHaveProperty('requirements');
  });

  it('removes a list with remove()', () => {
    const { UpdateExpression } = course
      .patch({ courseId: 'course-1' })
      .remove(['requirements'])
      .params() as { UpdateExpression: string };

    expect(UpdateExpression).toContain('REMOVE #requirements');
  });

  it('takes the updatedAt a writer passes, and stamps the time otherwise', () => {
    const at = '2026-01-01T00:00:00.000Z';
    const passed = course
      .patch({ courseId: 'course-1' })
      .set({ title: 'x', updatedAt: at })
      .params() as { ExpressionAttributeValues: Record<string, unknown> };
    const stamped = course
      .patch({ courseId: 'course-1' })
      .set({ title: 'x' })
      .params() as { ExpressionAttributeValues: Record<string, unknown> };

    expect(passed.ExpressionAttributeValues[':updatedAt_u0']).toBe(at);
    expect(stamped.ExpressionAttributeValues[':updatedAt_u0']).not.toBe(at);
  });
});

describe('course certificateCriteria', () => {
  it('stores the criteria it is given', () => {
    const { Item } = course.create(record).params() as {
      Item: Record<string, unknown>;
    };
    expect(Item.certificateCriteria).toEqual({
      version: 1,
      requireQuizPass: false,
    });
  });

  it('refuses a course without certificateCriteria', () => {
    const { certificateCriteria: _omitted, ...rest } = record;
    expect(() => course.create(rest as never).params()).toThrow(
      'certificateCriteria',
    );
  });
});
