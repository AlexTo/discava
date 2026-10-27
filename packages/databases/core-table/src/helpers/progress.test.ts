/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { type Curriculum, computeProgress } from './progress.js';

type Shown = { visibility?: 'visible' | 'hidden'; archivedAt?: string };

const module = (moduleId: string, state: Shown = {}) => ({
  moduleId,
  visibility: 'visible' as const,
  ...state,
});
const lesson = (moduleId: string, lessonId: string, state: Shown = {}) => ({
  moduleId,
  lessonId,
  visibility: 'visible' as const,
  ...state,
});
const item = (lessonId: string, contentItemId: string, state: Shown = {}) => ({
  moduleId: lessonId.startsWith('l2') ? 'm2' : 'm1',
  lessonId,
  contentItemId,
  visibility: 'visible' as const,
  ...state,
});

// m1: l1 (a, b), l1b (c). m2: l2 (d).
const course = (changes: Partial<Curriculum> = {}): Curriculum => ({
  modules: [module('m1'), module('m2')],
  lessons: [lesson('m1', 'l1'), lesson('m1', 'l1b'), lesson('m2', 'l2')],
  contentItems: [
    item('l1', 'a'),
    item('l1', 'b'),
    item('l1b', 'c'),
    item('l2', 'd'),
  ],
  ...changes,
});

const done = (...ids: string[]) => new Set(ids);

describe('computeProgress', () => {
  it('marks each lesson not started, in progress or completed', () => {
    expect(computeProgress(course(), done('a', 'c')).lessons).toEqual([
      { lessonId: 'l1', status: 'in_progress' },
      { lessonId: 'l1b', status: 'completed' },
      { lessonId: 'l2', status: 'not_started' },
    ]);
  });

  it('gives the share of items completed, rounded down', () => {
    // 3 of 4 is 75; 1 of 3 would be 33.3.
    expect(computeProgress(course(), done('a', 'b', 'c')).progressPercent).toBe(
      75,
    );
    const three = course({
      contentItems: [item('l1', 'a'), item('l1', 'b'), item('l1b', 'c')],
      lessons: [lesson('m1', 'l1'), lesson('m1', 'l1b')],
    });
    expect(computeProgress(three, done('a')).progressPercent).toBe(33);
  });

  it('is complete only when every visible item is', () => {
    expect(computeProgress(course(), done('a', 'b', 'c')).completed).toBe(
      false,
    );
    expect(computeProgress(course(), done('a', 'b', 'c', 'd'))).toMatchObject({
      progressPercent: 100,
      completed: true,
    });
  });

  // Invariant: only what students can see counts.
  it.each([
    [
      'a hidden item',
      {
        contentItems: [
          ...course().contentItems.slice(0, 3),
          item('l2', 'd', { visibility: 'hidden' }),
        ],
      },
    ],
    [
      'an archived item',
      {
        contentItems: [
          ...course().contentItems.slice(0, 3),
          item('l2', 'd', { archivedAt: '2024-01-01' }),
        ],
      },
    ],
    [
      'an item in a hidden lesson',
      {
        lessons: [
          lesson('m1', 'l1'),
          lesson('m1', 'l1b'),
          lesson('m2', 'l2', { visibility: 'hidden' }),
        ],
      },
    ],
    [
      'an item in an archived module',
      { modules: [module('m1'), module('m2', { archivedAt: '2024-01-01' })] },
    ],
  ])('leaves out %s', (_, changes) => {
    // Without d, a, b and c are everything: the course is complete.
    const result = computeProgress(course(changes), done('a', 'b', 'c'));

    expect(result).toMatchObject({ progressPercent: 100, completed: true });
    expect(result.lessons.map(({ lessonId }) => lessonId)).toEqual([
      'l1',
      'l1b',
    ]);
  });

  // Removing a student's last unfinished item completes them.
  it('completes a student once the only item they hadn’t done is removed', () => {
    const before = computeProgress(course(), done('a', 'b', 'c'));
    const after = computeProgress(
      course({ contentItems: course().contentItems.slice(0, 3) }),
      done('a', 'b', 'c'),
    );

    expect(before.completed).toBe(false);
    expect(after.completed).toBe(true);
  });

  it('ignores completions of items that no longer count', () => {
    const result = computeProgress(
      course({ contentItems: course().contentItems.slice(0, 3) }),
      done('d'),
    );

    expect(result.progressPercent).toBe(0);
  });

  it('records nothing for a lesson with nothing visible in it', () => {
    const result = computeProgress(
      course({
        contentItems: [
          item('l1', 'a'),
          item('l1b', 'c', { visibility: 'hidden' }),
        ],
      }),
      done('a'),
    );

    expect(result.lessons).toEqual([{ lessonId: 'l1', status: 'completed' }]);
  });

  it('never completes a course with nothing visible in it', () => {
    expect(computeProgress(course({ contentItems: [] }), done())).toEqual({
      lessons: [],
      progressPercent: 0,
      completed: false,
    });
  });
});
