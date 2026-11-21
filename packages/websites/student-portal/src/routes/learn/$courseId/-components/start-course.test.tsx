/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type Handler,
  renderWithCoreApi,
} from '../../../../test/render-with-core-api';
import { StartCourse } from './start-course';

// There's no route tree in these renders; navigation is a spy.
const navigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, { useNavigate: () => navigate });
});

afterEach(() => navigate.mockReset());

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

const course = (lessons: ReturnType<typeof lesson>[]) => ({
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
      lessons,
    },
  ],
});

const threeLessons = course([
  lesson('lesson-1', 1),
  lesson('lesson-2', 2),
  lesson('lesson-3', 3),
]);

const completion = (lessonId: string) => ({
  courseId: 'course-1',
  contentItemId: `item-${lessonId}`,
  completedAt: AT,
});

const render = (handlers: Record<string, Handler> = {}) =>
  renderWithCoreApi(<StartCourse courseId="course-1" />, {
    handlers: {
      'course.view': () => threeLessons,
      'course.myItemCompletions': () => ({ items: [] }),
      'course.myLessonProgress': () => ({ lessons: [] }),
      'course.myEnrolment': () => null,
      ...handlers,
    },
  });

describe('StartCourse', () => {
  it('opens the first lesson for a new learner', async () => {
    render();

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith({
      to: '/learn/$courseId/lesson/$lessonId',
      params: { courseId: 'course-1', lessonId: 'lesson-1' },
      replace: true,
      state: { enrolled: true },
    });
  });

  it('opens the third lesson for a learner who completed two', async () => {
    render({
      'course.myItemCompletions': () => ({
        items: [completion('lesson-1'), completion('lesson-2')],
      }),
    });

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { courseId: 'course-1', lessonId: 'lesson-3' },
      }),
    );
  });

  it('opens the course home when no lesson is shown', async () => {
    render({ 'course.view': () => course([]) });

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith({
      to: '/learn/$courseId/home',
      params: { courseId: 'course-1' },
      replace: true,
      state: { enrolled: true },
    });
  });

  it('shows a status and navigates nowhere until completions and progress have loaded', async () => {
    render({ 'course.myItemCompletions': () => new Promise(() => {}) });

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Opening your course…',
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('says why the course cannot be opened', async () => {
    render({
      'course.view': () => {
        throw new ApiError('FORBIDDEN', 'Enrol to start learning');
      },
    });

    expect(
      await screen.findByRole('heading', { name: 'Enrol to start learning' }),
    ).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});
