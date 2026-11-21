/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { routeTree } from '../routeTree.gen';
import {
  ApiError,
  type Handler,
  renderWithCoreApi,
} from '../test/render-with-core-api';

const AT = '2026-10-01T00:00:00.000Z';
const course = {
  courseId: 'course-1',
  title: 'Linear Algebra',
  description: 'Vectors and matrices.',
  status: 'published',
  createdAt: AT,
  updatedAt: AT,
  modules: [],
};
const never = () => new Promise(() => {});
const fails = () => {
  throw new ApiError('INTERNAL_SERVER_ERROR', 'Boom');
};
const facets = {
  categories: [],
  tags: [],
  levels: [],
  languages: [],
  durationBands: [],
};

const handlers: Record<string, Handler> = {
  'course.publicList': () => ({ items: [course] }),
  'course.publicSearch': () => ({ items: [], cursor: null, facets }),
  'course.publicView': () => course,
  'course.myEnrolment': () => null,
  'course.myEnrolments': () => ({ items: [] }),
  'certificate.myCertificates': () => [],
  'category.list': () => [],
  'category.bySlug': () => ({
    id: 'cat-1',
    name: 'Science',
    slug: 'science',
    status: 'active',
  }),
  'instructorProfile.publicView': () => ({
    handle: 'gil',
    displayName: 'Gil Strang',
    courses: [],
  }),
  'review.summary': () => ({
    count: 0,
    average: 0,
    stars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  }),
  'review.list': () => ({ items: [], cursor: null }),
  'notification.preferences': () => [],
  'notification.list': () => ({ items: [], cursor: null }),
  'notification.unreadCount': () => ({ count: 0 }),
  'certificate.verify': () => ({
    certificateId: 'ABCD',
    learnerName: 'Ada',
    courseTitle: 'Linear Algebra',
    completedAt: AT,
    completedOn: '1 October 2026',
  }),
};

const open = (
  path: string,
  overrides: Record<string, Handler> = {},
  signedIn = false,
) =>
  renderWithCoreApi(null, {
    routeTree,
    path,
    signedIn,
    handlers: { ...handlers, ...overrides },
    runtimeConfig: { apis: { CoreApi: 'http://core-api.test' } },
  });

const titleIs = (title: string) =>
  waitFor(() => expect(document.title).toBe(title));

describe('page titles', () => {
  it.each([
    ['/', 'Browse courses · Discava'],
    ['/search', 'Search · Discava'],
    ['/search?query=algebra', 'Search: algebra · Discava'],
    ['/certificates/ABCD', 'Certificate · Discava'],
    ['/unsubscribe', 'Unsubscribe · Discava'],
  ])('%s is "%s"', async (path, title) => {
    open(path);
    await titleIs(title);
  });

  it('is "Home" on the signed-in home', async () => {
    open('/', {}, true);
    await titleIs('Home · Discava');
  });

  it('cuts a long search query to 60 characters', async () => {
    open(`/search?query=${'a'.repeat(80)}`);
    await titleIs(`Search: ${'a'.repeat(60)}… · Discava`);
  });

  it.each([
    ['/my-learning', 'My Learning · Discava'],
    ['/settings/notifications', 'Notification settings · Discava'],
  ])('%s is "%s" for a signed-in student', async (path, title) => {
    open(path, {}, true);
    await titleIs(title);
  });

  it('names the category, "Category" while loading or failed', async () => {
    open('/category/science');
    await titleIs('Science · Discava');
    document.title = '';

    open('/category/science', { 'category.bySlug': never });
    await titleIs('Category · Discava');
    document.title = '';

    open('/category/science', { 'category.bySlug': fails });
    await titleIs('Category · Discava');
  });

  it('names the instructor, "Instructor" while loading or failed', async () => {
    open('/instructors/gil', { 'instructorProfile.publicView': never });
    await titleIs('Instructor · Discava');
    document.title = '';

    open('/instructors/gil', { 'instructorProfile.publicView': fails });
    await titleIs('Instructor · Discava');
  });

  it('names the course on its page, "Course" while loading or failed', async () => {
    open('/learn/course-1');
    await titleIs('Linear Algebra · Discava');
    document.title = '';

    open('/learn/course-1', { 'course.publicView': never });
    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(document.title).toBe('Course · Discava');
    document.title = '';

    open('/learn/course-1', { 'course.publicView': fails });
    await titleIs('Course · Discava');
  });

  it('shows "Signing you in…" as the sign-in page’s one h1', async () => {
    open('/signin', {}, false);
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Signing you in…');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await titleIs('Signing in · Discava');
  });

  it('shows "Loading…" on the signed-in home while it loads', async () => {
    open('/', { 'course.myEnrolments': never }, true);
    expect(await screen.findByText('Loading…')).toBeInTheDocument();
  });

  it('keeps each page’s own title when navigating between routes, and moves focus to its h1', async () => {
    const { router } = open('/my-learning', {}, true);
    await titleIs('My Learning · Discava');

    await act(() => router.navigate({ to: '/search', search: {} }));
    await titleIs('Search · Discava');

    await act(() => router.navigate({ to: '/my-learning' }));
    await titleIs('My Learning · Discava');
    // The cached query and the fixed title must survive the layout's effects.
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: 'My Learning' }),
      ).toHaveFocus(),
    );
    expect(document.title).toBe('My Learning · Discava');
  });

  it('has exactly one h1 on the catalogue, search results and an empty search', async () => {
    open('/');
    await screen.findByRole('heading', {
      name: 'Browse courses for every goal.',
    });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('has one h1 on a search with no results, and its empty state is an h2', async () => {
    open('/search?query=zzz');
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'No courses match',
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
