/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  renderWithCoreApi,
} from '../../../../test/render-with-core-api';
import { CoursePage } from './course-page';

// The player itself is covered in common-shadcn; here it only shows what it got.
vi.mock('@discava/common-shadcn/components/hls-video', () => ({
  HlsVideo: ({ url, autoPlay }: { url: string; autoPlay?: boolean }) => (
    <div data-testid="player" data-autoplay={String(autoPlay)}>
      {url}
    </div>
  ),
}));

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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens at the section its address names, once the course has loaded', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    renderWithCoreApi(<CoursePage courseId="course-1" />, {
      signedIn: false,
      handlers: { 'course.publicView': () => course },
      path: '/#modules',
    });

    const modules = await screen.findByRole('region', {
      name: /modules in this course/,
    });
    await waitFor(() => expect(modules).toBe(document.activeElement));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(modules);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'start',
    });
  });

  it('stays at the top when its address names no section', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderPage();

    await screen.findByRole('region', { name: /modules in this course/ });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

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
      '/learn/course-1#modules',
    );
    expect(screen.getByText('4 lessons')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enrol now' })).toBeEnabled();
  });

  it('keeps every tab on the course page and lets a wide bar scroll', async () => {
    renderPage(() => ({ ...course, ...landing }));

    const tabs = within(
      await screen.findByRole('navigation', { name: 'Course sections' }),
    );
    const links = tabs.getAllByRole('link');
    expect(links).toHaveLength(6);
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(/^\/learn\/course-1#\w+$/);
      expect(link).toHaveClass('shrink-0', 'whitespace-nowrap');
    }
    expect(links[0].parentElement).toHaveClass('overflow-x-auto');
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
      '/learn/course-1#about',
    );
    expect(tabs.getByRole('link', { name: 'Modules' })).toHaveAttribute(
      'href',
      '/learn/course-1#modules',
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

  it('links a free preview lesson, with a badge, and leaves the rest as text', async () => {
    renderPage(() => ({
      ...course,
      modules: [
        {
          ...course.modules[0],
          lessons: [
            { ...course.modules[0].lessons[0], freePreview: true },
            { ...course.modules[0].lessons[1], freePreview: false },
            course.modules[0].lessons[2],
          ],
        },
        course.modules[1],
      ],
    }));

    const link = await screen.findByRole('link', {
      name: 'The geometry of linear equations',
    });
    expect(link).toHaveAttribute('href', '/learn/course-1/preview/lesson-1');
    const row = link.closest('li') as HTMLElement;
    expect(within(row).getByText('Free preview')).toBeVisible();
    expect(row.querySelector('button svg[class*="arrow"]')).toBeNull();
    const plain = screen
      .getByText('Elimination with matrices')
      .closest('li') as HTMLElement;
    expect(within(plain).queryByRole('link')).toBeNull();
    expect(within(plain).queryByText('Free preview')).toBeNull();
    expect(screen.getAllByText('Free preview')).toHaveLength(1);
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
    ).toHaveAttribute('href', '/courses');
  });

  describe('preview video', () => {
    const previewUrl = {
      url: 'https://media.test/courses/course-1/preview/n/master.m3u8',
      withCredentials: true,
      versionId: 'n',
      captions: [],
    };
    const renderWithPreview = (preview?: { durationSeconds: number }) =>
      renderWithCoreApi(<CoursePage courseId="course-1" />, {
        signedIn: false,
        handlers: {
          'course.publicView': () => ({ ...course, preview }),
          'course.previewVideoUrl': () => previewUrl,
        },
      });

    it('shows the poster, label and duration without asking for the video', async () => {
      const { calls } = renderWithPreview({ durationSeconds: 95 });

      expect(
        await screen.findByRole('button', { name: 'Play preview' }),
      ).toBeVisible();
      expect(screen.getByText(/Preview this course/)).toHaveTextContent(
        'Preview this course · 1:35',
      );
      expect(screen.queryByTestId('player')).not.toBeInTheDocument();
      expect(calls.map((call) => call.path)).not.toContain(
        'course.previewVideoUrl',
      );
    });

    it('asks for the video exactly once, when play is pressed', async () => {
      const { user, calls } = renderWithPreview({ durationSeconds: 95 });

      await user.click(
        await screen.findByRole('button', { name: 'Play preview' }),
      );

      const player = await screen.findByTestId('player');
      expect(player).toHaveTextContent(previewUrl.url);
      expect(player).toHaveAttribute('data-autoplay', 'true');
      await waitFor(() =>
        expect(
          calls.filter((call) => call.path === 'course.previewVideoUrl'),
        ).toHaveLength(1),
      );
    });

    it('shows the course image, and no player, without a preview', async () => {
      const { calls } = renderWithPreview(undefined);

      await screen.findByRole('heading', { name: 'Linear Algebra' });
      expect(
        screen.queryByRole('button', { name: 'Play preview' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/Preview this course/)).not.toBeInTheDocument();
      expect(calls.map((call) => call.path)).not.toContain(
        'course.previewVideoUrl',
      );
    });
  });
});
