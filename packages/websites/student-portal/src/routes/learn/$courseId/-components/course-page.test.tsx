/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  renderWithCoreApi,
} from '../../../../test/render-with-core-api';
import { CoursePage } from './course-page';

const course = {
  courseId: 'course-1',
  title: 'Linear Algebra',
  description: 'Vectors, matrices and the four subspaces.',
  status: 'published',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  modules: [
    {
      moduleId: 'module-1',
      title: 'Ax = b',
      lessons: [
        { lessonId: 'lesson-1', title: 'The geometry of linear equations' },
        { lessonId: 'lesson-2', title: 'Elimination with matrices' },
      ],
    },
    {
      moduleId: 'module-2',
      title: 'Orthogonality',
      lessons: [{ lessonId: 'lesson-3', title: 'Projections' }],
    },
  ],
};

const renderPage = (publicView: () => unknown = () => course) =>
  renderWithCoreApi(<CoursePage courseId="course-1" />, {
    signedIn: false,
    handlers: { 'course.publicView': publicView },
  });

describe('CoursePage', () => {
  it('heads the page with the course and what it contains', async () => {
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Linear Algebra' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /2 modules/ })).toHaveAttribute(
      'href',
      '#modules',
    );
    expect(screen.getByText('3 lessons')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enrol now' })).toBeEnabled();
  });

  it('places the course under Home', async () => {
    renderPage();

    const trail = within(
      await screen.findByRole('navigation', { name: 'breadcrumb' }),
    );
    expect(trail.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(trail.getByText('Linear Algebra')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('jumps to each section from the tab bar', async () => {
    renderPage();

    const tabs = within(
      await screen.findByRole('navigation', { name: 'Course sections' }),
    );
    expect(tabs.getByRole('link', { name: 'About' })).toHaveAttribute(
      'href',
      '#about',
    );
    expect(tabs.getByRole('link', { name: 'Modules' })).toHaveAttribute(
      'href',
      '#modules',
    );
    expect(
      screen.getByRole('region', { name: 'About this course' }),
    ).toHaveAttribute('id', 'about');
    expect(
      screen.getByRole('region', {
        name: 'There are 2 modules in this course',
      }),
    ).toHaveAttribute('id', 'modules');
  });

  it('lists each module, opening the first, and its lessons on request', async () => {
    const { user } = renderPage();

    expect(
      await screen.findByText('The geometry of linear equations'),
    ).toBeVisible();
    expect(screen.getByText('Module 1 · 2 lessons')).toBeInTheDocument();
    expect(screen.queryByText('Projections')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Orthogonality/ }));

    expect(screen.getByText('Projections')).toBeVisible();
    expect(screen.queryByText('Elimination with matrices')).toBeNull();
  });

  it("says when a course doesn't exist or isn't published", async () => {
    renderPage(() => {
      throw new ApiError('NOT_FOUND', 'Not found');
    });

    expect(
      await screen.findByRole('heading', { name: 'Course not found' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Browse courses/ }),
    ).toHaveAttribute('href', '/');
  });
});
