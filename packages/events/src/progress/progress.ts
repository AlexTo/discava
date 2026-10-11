/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { filterEffectivelyVisible } from '@discava/core-table';

export type LessonStatus = 'not_started' | 'in_progress' | 'completed';

interface CurriculumRecord {
  visibility: 'visible' | 'hidden';
  archivedAt?: string;
}

export interface Curriculum {
  modules: (CurriculumRecord & { moduleId: string })[];
  lessons: (CurriculumRecord & { moduleId: string; lessonId: string })[];
  contentItems: (CurriculumRecord & {
    moduleId: string;
    lessonId: string;
    contentItemId: string;
  })[];
}

export interface StudentProgress {
  // Each effectively visible lesson that has an effectively visible item.
  // A lesson with nothing a student can see has no progress to record.
  lessons: { lessonId: string; status: LessonStatus }[];
  // The share of the course's effectively visible items completed, rounded
  // down, so it's 100 only when every one is.
  progressPercent: number;
  // Every effectively visible item is completed, and there is at least one.
  completed: boolean;
}

// A student's progress through a course, recomputed from scratch from the
// current curriculum and their completions, so adding, removing, hiding or
// restoring content can never leave it wrong. Only what students can see
// counts: an item is counted while it, its lesson and its module are visible
// and not archived. Completions of anything else are kept but don't count.
export const computeProgress = (
  curriculum: Curriculum,
  completedItemIds: ReadonlySet<string>,
): StudentProgress => {
  const { lessons, contentItems } = filterEffectivelyVisible(curriculum);

  const itemIdsByLesson = new Map<string, string[]>();
  for (const { lessonId, contentItemId } of contentItems) {
    itemIdsByLesson.set(lessonId, [
      ...(itemIdsByLesson.get(lessonId) ?? []),
      contentItemId,
    ]);
  }

  const lessonProgress = lessons.flatMap(({ lessonId }) => {
    const itemIds = itemIdsByLesson.get(lessonId) ?? [];
    if (itemIds.length === 0) {
      return [];
    }
    const done = itemIds.filter((id) => completedItemIds.has(id)).length;
    const status: LessonStatus =
      done === itemIds.length
        ? 'completed'
        : done > 0
          ? 'in_progress'
          : 'not_started';
    return [{ lessonId, status }];
  });

  const total = contentItems.length;
  const done = contentItems.filter(({ contentItemId }) =>
    completedItemIds.has(contentItemId),
  ).length;
  return {
    lessons: lessonProgress,
    progressPercent: total === 0 ? 0 : Math.floor((done * 100) / total),
    completed: total > 0 && done === total,
  };
};
