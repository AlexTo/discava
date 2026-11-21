/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useCoursePlayer } from '../../../../hooks/use-course-player';
import { Unavailable } from './course-player';

// Opens the learner's next lesson (the first shown lesson for someone new),
// or the course home when no lesson is shown. It replaces itself in the
// history, so Back from the lesson returns to where the learner came from.
export function StartCourse({ courseId }: { courseId: string }) {
  const navigate = useNavigate();
  const { error, isPlaceReady, nextLesson, retry } = useCoursePlayer(courseId);
  const lessonId = nextLesson?.lesson.lessonId;

  useEffect(() => {
    if (!isPlaceReady) return;
    void (lessonId
      ? navigate({
          to: '/learn/$courseId/lesson/$lessonId',
          params: { courseId, lessonId },
          replace: true,
          state: { enrolled: true },
        })
      : navigate({
          to: '/learn/$courseId/home',
          params: { courseId },
          replace: true,
          state: { enrolled: true },
        }));
  }, [isPlaceReady, lessonId, courseId, navigate]);

  if (error) {
    return <Unavailable courseId={courseId} error={error} onRetry={retry} />;
  }
  return (
    <main
      className="mx-auto flex w-full max-w-3xl items-center justify-center gap-3 px-6 py-24 text-sm text-muted-foreground lg:px-8"
      role="status"
    >
      <Spinner role="presentation" aria-hidden="true" />
      Opening your course…
    </main>
  );
}
