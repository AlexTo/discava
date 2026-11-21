/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createEnrolmentEntity } from './enrolment.js';

let enrolment: Awaited<ReturnType<typeof createEnrolmentEntity>>;
beforeAll(async () => {
  enrolment = await createEnrolmentEntity();
});

const record = { courseId: 'course-1', userId: 'user-1' };

describe('enrolment', () => {
  it('accepts a record without firstLessonPromptState', () => {
    const { Item } = enrolment.create(record).params() as {
      Item: Record<string, unknown>;
    };
    expect(Item.firstLessonPromptState).toBeUndefined();
  });

  it.each(['answered', 'dismissed'] as const)('accepts %s', (state) => {
    const { Item } = enrolment
      .create({ ...record, firstLessonPromptState: state })
      .params() as { Item: Record<string, unknown> };
    expect(Item.firstLessonPromptState).toBe(state);
  });

  it('refuses any other state', () => {
    expect(() =>
      enrolment
        .create({ ...record, firstLessonPromptState: 'later' as never })
        .params(),
    ).toThrow();
  });
});
