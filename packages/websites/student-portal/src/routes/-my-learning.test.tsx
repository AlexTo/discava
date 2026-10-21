/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { routeTree } from '../routeTree.gen';
import { type Handler, renderWithCoreApi } from '../test/render-with-core-api';

const AT = '2026-10-01T00:00:00.000Z';

const enrolment = (
  courseId: string,
  overrides: Record<string, unknown> = {},
) => ({
  courseId,
  title: `Course ${courseId}`,
  courseStatus: 'published',
  status: 'active',
  progressPercent: 40,
  enrolledAt: AT,
  nextLesson: {
    lessonId: `${courseId}-lesson`,
    title: `Next in ${courseId}`,
    moduleTitle: 'Vectors',
    moduleIndex: 1,
  },
  newItemCount: 0,
  ...overrides,
});

const catalogueCourse = (courseId: string) => ({
  courseId,
  title: `Catalogue ${courseId}`,
  status: 'published',
  createdAt: AT,
  updatedAt: AT,
});

// Most recently active first, as core-api returns them.
const enrolments = [
  enrolment('c1'),
  enrolment('c2', { progressPercent: 10 }),
  enrolment('c3', {
    status: 'completed',
    progressPercent: 80,
    completedAt: AT,
    nextLesson: null,
    newItemCount: 1,
  }),
];

const open = (path: string, handlers: Record<string, Handler> = {}) =>
  renderWithCoreApi(null, {
    routeTree,
    path,
    signedIn: true,
    handlers: {
      'course.myEnrolments': () => ({ items: enrolments }),
      'course.publicList': () => ({
        items: ['c1', 'c4', 'c5'].map(catalogueCourse),
        cursor: null,
      }),
      ...handlers,
    },
  });

describe('the signed-in home', () => {
  it('continues the course the student was last active in', async () => {
    open('/');

    expect(
      await screen.findByRole('heading', { name: /^Welcome back,/ }),
    ).toBeInTheDocument();
    const hero = screen.getByRole('heading', { name: 'Course c1' })
      .parentElement as HTMLElement;
    expect(
      within(hero).getByText('Next in c1', { exact: false }),
    ).toBeInTheDocument();
    expect(
      within(hero).getByRole('link', { name: 'Continue: Course c1' }),
    ).toHaveAttribute('href', '/learn/c1/lesson/c1-lesson');
  });

  it('lists the student’s other courses in progress', async () => {
    open('/');

    const section = await screen.findByRole('region', {
      name: 'Your other courses',
    });
    expect(within(section).getByText('Course c2')).toBeInTheDocument();
    // Completed courses are in My Learning, not here.
    expect(within(section).queryByText('Course c3')).toBeNull();
    expect(
      within(section).getByRole('link', { name: 'See all in My Learning' }),
    ).toHaveAttribute('href', '/my-learning');
  });

  it('suggests courses the student isn’t enrolled in', async () => {
    open('/');

    const section = await screen.findByRole('region', {
      name: 'Courses to start',
    });
    expect(
      await within(section).findByText('Catalogue c4'),
    ).toBeInTheDocument();
    expect(within(section).queryByText('Catalogue c1')).toBeNull();
  });

  it('welcomes a student with no courses yet', async () => {
    open('/', { 'course.myEnrolments': () => ({ items: [] }) });

    expect(
      await screen.findByRole('heading', { name: /^Welcome, /i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Browse courses/ }),
    ).toBeInTheDocument();
  });
});

describe('/my-learning', () => {
  it('splits courses into in progress and completed', async () => {
    const { user } = open('/my-learning');

    expect(
      await screen.findByRole('tab', { name: 'In progress (2)' }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Course c1')).toBeInTheDocument();
    expect(screen.getByText('Course c2')).toBeInTheDocument();
    expect(screen.queryByText('Course c3')).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Completed (1)' }));

    expect(await screen.findByText('Course c3')).toBeInTheDocument();
    expect(screen.getByText('· 1 new item')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'See what’s new: Course c3' }),
    ).toHaveAttribute('href', '/learn/c3/home');
  });

  it('shows each course’s next lesson', async () => {
    open('/my-learning');

    expect(
      await screen.findByText('Next in c2', { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Continue: Course c2' }),
    ).toHaveAttribute('href', '/learn/c2/lesson/c2-lesson');
  });

  it('is linked from the top bar', async () => {
    open('/');

    expect(
      await screen.findByRole('link', { name: 'My Learning' }),
    ).toHaveAttribute('href', '/my-learning');
  });
});
