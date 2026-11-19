/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createCourseEntity } from './course.js';

// The requests ElectroDB would send, checked without a table.

let course: Awaited<ReturnType<typeof createCourseEntity>>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  course = await createCourseEntity();
});

const record = {
  courseId: 'course-1',
  title: 'A course',
  certificatesEnabled: true,
};

describe('course', () => {
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
