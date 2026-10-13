/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { studentsToRecalculate } from './progress-recalculation.js';

type Record = Parameters<typeof studentsToRecalculate>[0][number];

const record = (
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  oldImage?: { [key: string]: unknown },
  newImage?: { [key: string]: unknown },
) =>
  ({
    eventName,
    dynamodb: { OldImage: oldImage, NewImage: newImage },
  }) as unknown as Record;

const completion = (userId: string, courseId = 'course-1') =>
  record('INSERT', undefined, {
    __edb_e__: 'itemCompletion',
    userId,
    courseId,
  });

const curriculumChange = (
  before: { [key: string]: unknown },
  after: { [key: string]: unknown },
  entity = 'contentItem',
) =>
  record(
    'MODIFY',
    {
      __edb_e__: entity,
      courseId: 'course-1',
      visibility: 'visible',
      ...before,
    },
    {
      __edb_e__: entity,
      courseId: 'course-1',
      visibility: 'visible',
      ...after,
    },
  );

const asLists = (result: Map<string, Set<string>>) =>
  Object.fromEntries([...result].map(([course, ids]) => [course, [...ids]]));

describe('studentsToRecalculate', () => {
  const enrolled = vi.fn(async (courseId: string) =>
    courseId === 'course-1' ? ['s1', 's2'] : ['s3'],
  );

  it('recalculates the student of each completion, once', async () => {
    const result = await studentsToRecalculate(
      [completion('s1'), completion('s1'), completion('s4', 'course-2')],
      enrolled,
    );

    expect(asLists(result)).toEqual({ 'course-1': ['s1'], 'course-2': ['s4'] });
    expect(enrolled).not.toHaveBeenCalled();
  });

  it.each([
    ['hidden', { visibility: 'visible' }, { visibility: 'hidden' }],
    ['published', { visibility: 'hidden' }, { visibility: 'visible' }],
    ['archived', {}, { archivedAt: '2024-01-01' }],
    ['restored', { archivedAt: '2024-01-01' }, {}],
  ])(
    'recalculates everyone enrolled when a record is %s',
    async (_, before, after) => {
      const result = await studentsToRecalculate(
        [curriculumChange(before, after)],
        enrolled,
      );

      expect(asLists(result)).toEqual({ 'course-1': ['s1', 's2'] });
    },
  );

  it('recalculates everyone enrolled when a record is removed', async () => {
    const result = await studentsToRecalculate(
      [record('REMOVE', { __edb_e__: 'lesson', courseId: 'course-1' })],
      enrolled,
    );

    expect(asLists(result)).toEqual({ 'course-1': ['s1', 's2'] });
  });

  it('ignores edits that don’t change what students see', async () => {
    enrolled.mockClear();

    const result = await studentsToRecalculate(
      [
        curriculumChange({ title: 'Old' }, { title: 'New' }),
        curriculumChange({ order: 1 }, { order: 2 }, 'module'),
        curriculumChange(
          { studentActivityCount: 0 },
          { studentActivityCount: 1 },
        ),
      ],
      enrolled,
    );

    expect(asLists(result)).toEqual({});
    expect(enrolled).not.toHaveBeenCalled();
  });

  it('lists a course’s students once for a burst of changes, together with its completions', async () => {
    enrolled.mockClear();

    const result = await studentsToRecalculate(
      [
        curriculumChange({}, { visibility: 'hidden' }),
        curriculumChange({}, { archivedAt: '2024-01-01' }, 'lesson'),
        completion('s5'),
      ],
      enrolled,
    );

    expect(enrolled).toHaveBeenCalledTimes(1);
    expect(asLists(result)).toEqual({ 'course-1': ['s5', 's1', 's2'] });
  });

  it('ignores records of other entities', async () => {
    const result = await studentsToRecalculate(
      [
        record(
          'MODIFY',
          { __edb_e__: 'enrolment', courseId: 'course-1' },
          { __edb_e__: 'enrolment', courseId: 'course-1', progressPercent: 50 },
        ),
        record('INSERT', undefined, {
          __edb_e__: 'quizAttempt',
          courseId: 'course-1',
          userId: 's1',
        }),
      ],
      enrolled,
    );

    expect(asLists(result)).toEqual({});
  });
});
