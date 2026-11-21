/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createLessonEntity } from './lesson.js';

// The requests ElectroDB would send, checked without a table.

let lesson: Awaited<ReturnType<typeof createLessonEntity>>;
beforeAll(async () => {
  lesson = await createLessonEntity();
});

const key = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
};

type UpdateParams = {
  UpdateExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
};

describe('lesson freePreview', () => {
  it('is absent on a lesson created without it', () => {
    const { Item } = lesson
      .create({
        ...key,
        title: 'Intro',
        order: 1,
        visibility: 'hidden',
      })
      .params() as { Item: Record<string, unknown> };

    expect(Item).not.toHaveProperty('freePreview');
  });

  it('is set by a patch that marks the lesson', () => {
    const params = lesson
      .patch(key)
      .set({ freePreview: true })
      .params() as UpdateParams;

    expect(Object.values(params.ExpressionAttributeNames)).toContain(
      'freePreview',
    );
    expect(Object.values(params.ExpressionAttributeValues)).toContain(true);
  });

  it('is removed by a patch that unmarks the lesson', () => {
    const params = lesson
      .patch(key)
      .remove(['freePreview'])
      .params() as UpdateParams;

    expect(params.UpdateExpression).toContain('REMOVE #freePreview');
    expect(Object.values(params.ExpressionAttributeValues)).not.toContain(
      false,
    );
  });
});
