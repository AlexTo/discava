/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useQuery } from '@tanstack/react-query';
import { useInstructorApi } from '../../../../../../hooks/useInstructorApi';

export interface LessonRef {
  courseId: string;
  moduleId: string;
  lessonId: string;
}

// 'shown' means students can open it; the others are why they cannot.
export type LessonState = 'shown' | 'hidden' | 'archived';

export interface CourseLesson {
  moduleId: string;
  lessonId: string;
  title: string;
  state: LessonState;
}

// The course's lessons with their state, and whether the course is archived,
// from the instructor's course read. Questions are still readable for a
// lesson students cannot open, but cannot be answered.
export interface CourseLessons {
  courseArchived: boolean;
  lessons: CourseLesson[];
}

// The parts of the query the views use, spelled out so the declaration emit
// doesn't have to name the API router's inferred types.
export interface CourseLessonsQuery {
  data: CourseLessons | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

export function useCourseLessons(courseId: string): CourseLessonsQuery {
  const trpc = useInstructorApi();
  return useQuery({
    ...trpc.course.view.queryOptions({ courseId }),
    select: (course): CourseLessons => ({
      courseArchived: course.status === 'archived',
      lessons: course.modules.flatMap((module): CourseLesson[] =>
        module.lessons.map((lesson) => ({
          moduleId: module.moduleId,
          lessonId: lesson.lessonId,
          title: lesson.title,
          state:
            module.archivedAt || lesson.archivedAt
              ? 'archived'
              : module.visibility === 'hidden' || lesson.visibility === 'hidden'
                ? 'hidden'
                : 'shown',
        })),
      ),
    }),
  });
}

export const lessonStateLabel = (state: LessonState | undefined) =>
  state === 'archived' ? 'archived' : state === 'hidden' ? 'hidden' : undefined;
