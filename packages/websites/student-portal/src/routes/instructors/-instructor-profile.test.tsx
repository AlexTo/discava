/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { routeTree } from '../../routeTree.gen';
import { ApiError, renderWithCoreApi } from '../../test/render-with-core-api';

const profile = {
  handle: 'gil',
  displayName: 'Gil Strang',
  headline: 'Professor of mathematics',
  bio: 'First paragraph.\n\nSecond paragraph.',
  courses: [
    {
      courseId: 'course-1',
      title: 'Linear Algebra',
      ratingAverage: 4.5,
      ratingCount: 2,
    },
    { courseId: 'course-2', title: 'Calculus', ratingCount: 0 },
  ],
};

const open = (
  handler: (input: unknown) => unknown = () => profile,
  path = '/instructors/gil',
) =>
  renderWithCoreApi(null, {
    routeTree,
    path,
    signedIn: false,
    handlers: { 'instructorProfile.publicView': handler },
  });

describe('/instructors/$handle', () => {
  it('shows the name, headline and bio paragraphs', async () => {
    open();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Gil Strang' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Professor of mathematics')).toBeInTheDocument();
    expect(screen.getByText('First paragraph.')).toBeInTheDocument();
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument();
  });

  it('shows a breadcrumb from Home to the instructor, like the other pages', async () => {
    open();

    const breadcrumb = await screen.findByRole('navigation', {
      name: 'breadcrumb',
    });
    expect(
      within(breadcrumb).getByRole('link', { name: 'Home' }),
    ).toHaveAttribute('href', '/');
    expect(await within(breadcrumb).findByText('Gil Strang')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('asks for the handle in the address', async () => {
    const { calls } = open(() => profile, '/instructors/gil');
    await screen.findByRole('heading', { level: 1, name: 'Gil Strang' });
    expect(
      calls.find(({ path }) => path === 'instructorProfile.publicView')?.input,
    ).toEqual({ handle: 'gil' });
  });

  it('lists the courses as catalogue cards linking to them', async () => {
    open();

    const section = await screen.findByRole('region', {
      name: 'Courses by Gil Strang',
    });
    expect(within(section).getByText('Linear Algebra')).toBeInTheDocument();
    expect(within(section).getByText('Calculus')).toBeInTheDocument();
    expect(within(section).getByText('4.5')).toBeInTheDocument();
    expect(within(section).getByText('No ratings yet')).toBeInTheDocument();
    expect(
      within(section).getByRole('link', { name: 'Linear Algebra' }),
    ).toHaveAttribute('href', '/learn/course-1');
  });

  it('draws the picture at its full size, not the large avatar size', async () => {
    const { container } = open();
    await screen.findByRole('heading', { level: 1, name: 'Gil Strang' });
    const avatar = container.querySelector('[data-slot="avatar"]');
    expect(avatar).toHaveClass('size-28');
    expect(avatar).not.toHaveAttribute('data-size', 'lg');
  });

  it('says so when there are no published courses, and not otherwise', async () => {
    open();
    await screen.findByRole('region', { name: 'Courses by Gil Strang' });
    expect(screen.queryByText('No published courses yet.')).toBeNull();
  });

  it('says there are no published courses yet for an instructor without any', async () => {
    open(() => ({ ...profile, courses: [] }));
    const section = await screen.findByRole('region', {
      name: 'Courses by Gil Strang',
    });
    expect(
      within(section).getByText('No published courses yet.'),
    ).toBeInTheDocument();
    expect(within(section).queryByRole('link')).toBeNull();
  });

  it('sets the document title to the display name', async () => {
    open();
    await screen.findByRole('heading', { level: 1, name: 'Gil Strang' });
    await waitFor(() => expect(document.title).toBe('Gil Strang · Discava'));
  });

  it('shows initials when there is no photo, and leaves out a missing headline and bio', async () => {
    open(() => ({ ...profile, headline: undefined, bio: undefined }));

    await screen.findByRole('heading', { level: 1, name: 'Gil Strang' });
    expect(screen.getByText('GS')).toBeInTheDocument();
    expect(screen.queryByText('Professor of mathematics')).toBeNull();
    expect(screen.queryByText('First paragraph.')).toBeNull();
  });

  it('renders bio markup as text', async () => {
    const { container } = open(() => ({
      ...profile,
      displayName: '<b>Bold</b>',
      bio: '<script>alert(1)</script><img src=x onerror=alert(1)>\n\n[link](https://example.com)',
    }));

    expect(
      await screen.findByText(
        '<script>alert(1)</script><img src=x onerror=alert(1)>',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('[link](https://example.com)')).toBeInTheDocument();
    expect(screen.getAllByText('<b>Bold</b>').length).toBeGreaterThan(0);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.querySelector('main b')).toBeNull();
  });

  it('shows "Instructor not found" with a way back for NOT_FOUND', async () => {
    open(() => {
      throw new ApiError('NOT_FOUND', 'Instructor not found');
    });

    expect(
      await screen.findByRole('heading', { name: 'Instructor not found' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Browse courses' }),
    ).toHaveAttribute('href', '/courses');
  });

  it('offers a retry, not "not found", when the call fails otherwise', {
    timeout: 15_000,
  }, async () => {
    open(() => {
      throw new ApiError('TIMEOUT', 'Starting up.');
    });

    expect(
      await screen.findByText("Couldn't load this profile", undefined, {
        timeout: 10_000,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Instructor not found')).toBeNull();
  });
});
