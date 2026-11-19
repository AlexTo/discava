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
        {
          lessonId: 'lesson-4',
          title: 'Problem set 1',
          kind: 'assignment',
        },
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

const landing = {
  learningOutcomes: ['Solve linear systems', 'Find eigenvalues'],
  requirements: ['Comfort with high-school algebra'],
  level: 'intermediate',
  language: 'en',
  durationHours: 12,
  instructors: [
    {
      handle: 'gil',
      displayName: 'Gil Strang',
      headline: 'Professor of mathematics',
    },
    { handle: 'ada', displayName: 'Ada' },
  ],
};

const sectionNames = () =>
  within(screen.getByRole('navigation', { name: 'Course sections' }))
    .getAllByRole('link')
    .map((link) => link.textContent);

describe('CoursePage', () => {
  it('shows the outcomes, requirements, facts and instructors', async () => {
    renderPage(() => ({ ...course, ...landing }));

    const outcomes = await screen.findByRole('region', {
      name: "What you'll learn",
    });
    expect(within(outcomes).getAllByRole('listitem')).toHaveLength(2);
    expect(
      within(outcomes).getByText('Solve linear systems'),
    ).toBeInTheDocument();
    const requirements = screen.getByRole('region', { name: 'Requirements' });
    expect(
      within(requirements).getByText('Comfort with high-school algebra'),
    ).toBeInTheDocument();
    expect(screen.getByText('Intermediate')).toBeInTheDocument();
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('12 hours')).toBeInTheDocument();
    const team = screen.getByRole('region', { name: 'Instructors' });
    expect(
      within(team).getByRole('heading', { name: 'Gil Strang' }),
    ).toBeInTheDocument();
    expect(
      within(team).getByText('Professor of mathematics'),
    ).toBeInTheDocument();
    expect(within(team).getAllByText('View profile')).toHaveLength(2);
    // The name has no photo here, so its initials stand in.
    expect(within(team).getByText('GS')).toBeInTheDocument();
    expect(within(team).getByText('A')).toBeInTheDocument();
  });

  it('puts the sections in order, and the tab bar matches', async () => {
    renderPage(() => ({ ...course, ...landing }));

    await screen.findByRole('region', { name: "What you'll learn" });
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings.slice(0, 5)).toEqual([
      "What you'll learn",
      'About this course',
      'Requirements',
      'There are 2 modules in this course',
      'Instructors',
    ]);
    expect(sectionNames()).toEqual([
      "What you'll learn",
      'About',
      'Requirements',
      'Modules',
      'Instructors',
      'Reviews',
    ]);
  });

  it('leaves out the sections that are empty, and their tabs', async () => {
    renderPage(() => ({
      ...course,
      learningOutcomes: [],
      requirements: [],
      instructors: [],
    }));

    await screen.findByRole('heading', { level: 1, name: 'Linear Algebra' });
    expect(
      screen.queryByRole('region', { name: "What you'll learn" }),
    ).toBeNull();
    expect(screen.queryByRole('region', { name: 'Requirements' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Instructors' })).toBeNull();
    expect(sectionNames()).toEqual(['About', 'Modules', 'Reviews']);
    expect(screen.queryByText('Level')).toBeNull();
    expect(screen.queryByText('Language')).toBeNull();
  });

  it('renders user text as text, never HTML', async () => {
    const script = '<script>alert(1)</script>';
    renderPage(() => ({
      ...course,
      learningOutcomes: [script],
      requirements: ['<b>bold</b>'],
      instructors: [
        { handle: 'x', displayName: '<img src=x onerror=alert(1)>' },
      ],
    }));

    expect(await screen.findByText(script)).toBeInTheDocument();
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
    expect(document.querySelector('img[onerror]')).toBeNull();
  });

  it('does not show announcements on the public course page', async () => {
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Linear Algebra' });
    expect(
      screen.queryByRole('heading', { name: 'Announcements' }),
    ).not.toBeInTheDocument();
  });

  it('heads the page with the course and what it contains', async () => {
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Linear Algebra' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /2 modules/ })).toHaveAttribute(
      'href',
      '#modules',
    );
    expect(screen.getByText('4 lessons')).toBeInTheDocument();
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
    expect(screen.getByText('Module 1 · 3 lessons')).toBeInTheDocument();
    expect(screen.queryByText('Projections')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Orthogonality/ }));

    expect(screen.getByText('Projections')).toBeVisible();
    expect(screen.queryByText('Elimination with matrices')).toBeNull();
  });

  it('marks an assignment in the outline with its label, and a lesson not', async () => {
    renderPage();

    const assignment = (await screen.findByText('Problem set 1')).closest('li');
    expect(assignment).not.toBeNull();
    expect(
      within(assignment as HTMLElement).getByText('Assignment'),
    ).toBeVisible();
    const lesson = screen
      .getByText('Elimination with matrices')
      .closest('li') as HTMLElement;
    expect(within(lesson).queryByText('Assignment')).toBeNull();
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
