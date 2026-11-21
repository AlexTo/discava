/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  filterEffectivelyVisible,
  firstShownLesson,
  isOpenFreePreview,
  isShown,
} from './curriculum.js';

const visible = { visibility: 'visible' as const };
const hidden = { visibility: 'hidden' as const };
const archived = { visibility: 'visible' as const, archivedAt: '2024-01-01' };

describe('isShown', () => {
  it('is true only for visible, unarchived records', () => {
    expect(isShown(visible)).toBe(true);
    expect(isShown(hidden)).toBe(false);
    expect(isShown(archived)).toBe(false);
  });
});

describe('isOpenFreePreview', () => {
  const open = {
    course: { status: 'published' },
    module: visible,
    lesson: { ...visible, kind: 'lesson' as const, freePreview: true },
  };

  it('is true for a marked, shown lesson of a published course', () => {
    expect(isOpenFreePreview(open)).toBe(true);
  });

  it.each([
    ['a draft course', { course: { status: 'draft' } }],
    ['an archived course', { course: { status: 'archived' } }],
    ['a hidden module', { module: hidden }],
    ['an archived module', { module: archived }],
    ['a hidden lesson', { lesson: { ...open.lesson, ...hidden } }],
    ['an archived lesson', { lesson: { ...open.lesson, ...archived } }],
    ['an unmarked lesson', { lesson: { ...visible, kind: 'lesson' as const } }],
    [
      'a lesson with freePreview false',
      { lesson: { ...open.lesson, freePreview: false } },
    ],
    [
      'an assignment lesson carrying the mark',
      { lesson: { ...open.lesson, kind: 'assignment' as const } },
    ],
  ])('is false for %s', (_name, override) => {
    expect(isOpenFreePreview({ ...open, ...override })).toBe(false);
  });
});

describe('filterEffectivelyVisible', () => {
  const curriculum = {
    modules: [
      { moduleId: 'm-visible', ...visible },
      { moduleId: 'm-hidden', ...hidden },
      { moduleId: 'm-archived', ...archived },
    ],
    lessons: [
      { moduleId: 'm-visible', lessonId: 'l-visible', ...visible },
      { moduleId: 'm-visible', lessonId: 'l-hidden', ...hidden },
      { moduleId: 'm-visible', lessonId: 'l-archived', ...archived },
      { moduleId: 'm-hidden', lessonId: 'l-under-hidden', ...visible },
      { moduleId: 'm-archived', lessonId: 'l-under-archived', ...visible },
    ],
    contentItems: [
      { lessonId: 'l-visible', contentItemId: 'c-visible', ...visible },
      { lessonId: 'l-visible', contentItemId: 'c-hidden', ...hidden },
      { lessonId: 'l-visible', contentItemId: 'c-archived', ...archived },
      { lessonId: 'l-hidden', contentItemId: 'c-under-hidden', ...visible },
      { lessonId: 'l-archived', contentItemId: 'c-under-archived', ...visible },
      {
        lessonId: 'l-under-hidden',
        contentItemId: 'c-under-hidden-module',
        ...visible,
      },
      {
        lessonId: 'l-under-archived',
        contentItemId: 'c-under-archived-module',
        ...visible,
      },
    ],
  };

  // Invariant: students never see a record that is hidden or archived, or
  // that sits under a hidden or archived ancestor.
  it('keeps only records that are visible, unarchived, and under shown ancestors', () => {
    const shown = filterEffectivelyVisible(curriculum);

    expect(shown.modules.map(({ moduleId }) => moduleId)).toEqual([
      'm-visible',
    ]);
    expect(shown.lessons.map(({ lessonId }) => lessonId)).toEqual([
      'l-visible',
    ]);
    expect(
      shown.contentItems.map(({ contentItemId }) => contentItemId),
    ).toEqual(['c-visible']);
  });
});

describe('firstShownLesson', () => {
  const module = (moduleId: string, order: number, state = visible) => ({
    moduleId,
    order,
    ...state,
  });
  const lesson = (
    moduleId: string,
    lessonId: string,
    order: number,
    state = visible,
  ) => ({ moduleId, lessonId, order, ...state });

  it('is the first lesson of the first module in course order', () => {
    expect(
      firstShownLesson({
        modules: [module('m2', 2), module('m1', 1)],
        lessons: [
          lesson('m2', 'x', 1),
          lesson('m1', 'b', 2),
          lesson('m1', 'a', 1),
        ],
      })?.lessonId,
    ).toBe('a');
  });

  it('skips a hidden first module', () => {
    expect(
      firstShownLesson({
        modules: [module('m1', 1, hidden), module('m2', 2)],
        lessons: [lesson('m1', 'a', 1), lesson('m2', 'b', 1)],
      })?.lessonId,
    ).toBe('b');
  });

  it('skips a hidden first lesson', () => {
    expect(
      firstShownLesson({
        modules: [module('m1', 1)],
        lessons: [lesson('m1', 'a', 1, hidden), lesson('m1', 'b', 2)],
      })?.lessonId,
    ).toBe('b');
  });

  it('skips an archived lesson', () => {
    expect(
      firstShownLesson({
        modules: [module('m1', 1)],
        lessons: [lesson('m1', 'a', 1, archived), lesson('m1', 'b', 2)],
      })?.lessonId,
    ).toBe('b');
  });

  it('is undefined when no lesson is shown', () => {
    expect(firstShownLesson({ modules: [], lessons: [] })).toBeUndefined();
    expect(
      firstShownLesson({
        modules: [module('m1', 1), module('m2', 2, hidden)],
        lessons: [lesson('m1', 'a', 1, hidden), lesson('m2', 'b', 1)],
      }),
    ).toBeUndefined();
  });
});
