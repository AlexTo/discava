/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { filterEffectivelyVisible, isShown } from './curriculum.js';

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
