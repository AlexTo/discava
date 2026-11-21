/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { type Handler, renderWithCoreApi } from '../test/render-with-core-api';
import { useCoursePlayer } from './use-course-player';

const AT = '2026-10-01T00:00:00.000Z';

const lesson = (lessonId: string, order: number) => ({
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId,
  createdAt: AT,
  updatedAt: AT,
  title: `Lesson ${order}`,
  order,
  contentItems: [
    {
      courseId: 'course-1',
      moduleId: 'module-1',
      lessonId,
      contentItemId: `item-${lessonId}`,
      type: 'text',
      status: 'ready',
      title: `Item ${order}`,
      order: 1,
      body: '{}',
      createdAt: AT,
      updatedAt: AT,
    },
  ],
});

const course = {
  courseId: 'course-1',
  title: 'Linear Algebra',
  status: 'published',
  createdAt: AT,
  updatedAt: AT,
  modules: [
    {
      moduleId: 'module-1',
      courseId: 'course-1',
      title: 'Unit 1',
      order: 1,
      createdAt: AT,
      updatedAt: AT,
      lessons: [
        lesson('lesson-1', 1),
        lesson('lesson-2', 2),
        lesson('lesson-3', 3),
      ],
    },
  ],
};

const completion = (lessonId: string) => ({
  courseId: 'course-1',
  contentItemId: `item-${lessonId}`,
  completedAt: AT,
});

function Probe() {
  const player = useCoursePlayer('course-1');
  return (
    <p>
      ready:{String(player.isPlaceReady)} next:
      {player.nextLesson?.lesson.lessonId ?? 'none'}
    </p>
  );
}

const render = (handlers: Record<string, Handler>) =>
  renderWithCoreApi(<Probe />, {
    handlers: {
      'course.view': () => course,
      'course.myItemCompletions': () => ({ items: [] }),
      'course.myLessonProgress': () => ({ lessons: [] }),
      'course.myEnrolment': () => null,
      ...handlers,
    },
  });

describe('useCoursePlayer isPlaceReady', () => {
  it('is false while the completions are pending', async () => {
    render({ 'course.myItemCompletions': () => new Promise(() => {}) });

    expect(await screen.findByText(/ready:false/)).toBeInTheDocument();
    // Give the other queries time to settle: still not ready.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText(/ready:false/)).toBeInTheDocument();
  });

  it('is false while the lesson progress is pending', async () => {
    render({ 'course.myLessonProgress': () => new Promise(() => {}) });

    await screen.findByText(/ready:false/);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText(/ready:false/)).toBeInTheDocument();
  });

  it('is true once the course, completions and progress have loaded', async () => {
    render({});

    expect(
      await screen.findByText(/ready:true next:lesson-1/),
    ).toBeInTheDocument();
  });

  it('points a learner who completed two lessons at the third', async () => {
    render({
      'course.myItemCompletions': () => ({
        items: [completion('lesson-1'), completion('lesson-2')],
      }),
    });

    expect(
      await screen.findByText(/ready:true next:lesson-3/),
    ).toBeInTheDocument();
  });
});
