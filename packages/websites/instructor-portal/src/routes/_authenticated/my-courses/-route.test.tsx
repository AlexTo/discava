/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { RuntimeConfigContext } from '@discava/common-web-utils/runtime-config';
import { ApiError, fakeTrpcFetch } from '@discava/common-web-utils/testing';
import type { AppRouter as CoreApiRouter } from '@discava/core-api';
import type { AppRouter as InstructorApiRouter } from '@discava/instructor-api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { type ReactElement, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoreApiTRPCContext, InstructorApiTRPCContext } from '../../../api';

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { profile: { sub: 'instructor-1' } } }),
}));
// Link needs a router context this test doesn't set up; a plain anchor, its
// `to`/`params` captured instead, keeps the course list's own logic testable.
const linkProps = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, {
    Link: ({
      children,
      to,
      params,
      'aria-label': ariaLabel,
    }: {
      children: React.ReactNode;
      to: string;
      params: Record<string, unknown>;
      'aria-label'?: string;
    }) => {
      linkProps.push({ to, params });
      return (
        <a href="#" aria-label={ariaLabel}>
          {children}
        </a>
      );
    },
    // CreateCourseDialog navigates on save, which also needs a router this
    // test doesn't set up; not under test here (see create-course-dialog.test.tsx).
    useNavigate: () => vi.fn(),
  });
});

const { Route } = await import('./route');
const RouteComponent = Route.options.component!;

// The address stands in for the router's: a small store the page reads and
// writes through useSearch and useNavigate, with each write recorded.
type Search = { status: string; q: string };
const defaults: Search = { status: 'all', q: '' };
let search = defaults;
const listeners = new Set<() => void>();
const navigations: { search: Search; replace?: boolean }[] = [];
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const setSearch = (next: Search) => {
  search = next;
  for (const listener of listeners) listener();
};
const validate = Route.options.validateSearch as (
  search: Record<string, unknown>,
) => Search;

const course = (
  courseId: string,
  title: string,
  status: 'draft' | 'published' | 'archived',
  updatedAt = '2026-03-04T10:00:00.000Z',
) => ({
  courseId,
  title,
  description: '',
  imageKey: undefined,
  status,
  updatedAt,
});

// The page itself reads from core-api, but also renders CreateCourseDialog,
// which calls useInstructorApi() as soon as it mounts (to set up its create
// mutation) even before it's opened, so both APIs need a context here.
const renderPage = (coreHandlers = {}, instructorHandlers = {}) => {
  const calls: { path: string; input: unknown }[] = [];
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const coreClient = createTRPCClient<CoreApiRouter>({
    links: [
      httpLink({
        url: 'http://core-api.test/',
        fetch: fakeTrpcFetch(coreHandlers, calls),
      }),
    ],
  });
  const instructorClient = createTRPCClient<InstructorApiRouter>({
    links: [
      httpLink({
        url: 'http://instructor-api.test/',
        fetch: fakeTrpcFetch(instructorHandlers, []),
      }),
    ],
  });
  const user = userEvent.setup();
  const result = render(
    <RuntimeConfigContext.Provider value={{ media: {} }}>
      <QueryClientProvider client={queryClient}>
        <CoreApiTRPCContext.Provider
          value={{
            client: coreClient,
            optionsProxy: createTRPCOptionsProxy<CoreApiRouter>({
              client: coreClient,
              queryClient,
            }),
          }}
        >
          <InstructorApiTRPCContext.Provider
            value={{
              client: instructorClient,
              optionsProxy: createTRPCOptionsProxy<InstructorApiRouter>({
                client: instructorClient,
                queryClient,
              }),
            }}
          >
            {(<RouteComponent />) as ReactElement}
          </InstructorApiTRPCContext.Provider>
        </CoreApiTRPCContext.Provider>
      </QueryClientProvider>
    </RuntimeConfigContext.Provider>,
  );
  return { ...result, calls, user };
};

// What a route's beforeLoad does with the address as typed: nothing when it is
// already what the validated values would write, else a replace redirect.
const correction = (raw: Record<string, unknown>) => {
  const beforeLoad = Route.options.beforeLoad as (ctx: {
    search: unknown;
    location: { search: Record<string, unknown> };
  }) => void;
  try {
    beforeLoad({ search: validate(raw), location: { search: raw } });
  } catch (thrown) {
    return thrown as { options: { replace?: boolean; search: unknown } };
  }
};
const correctedTo = (raw: Record<string, unknown>) => {
  const redirect = correction(raw);
  expect(redirect?.options.replace).toBe(true);
  return (
    redirect?.options.search as (prev: Record<string, unknown>) => unknown
  )(raw);
};

beforeEach(() => {
  linkProps.length = 0;
  navigations.length = 0;
  search = defaults;
  vi.spyOn(Route, 'useSearch').mockImplementation(() =>
    useSyncExternalStore(subscribe, () => search),
  );
  vi.spyOn(Route, 'useNavigate').mockReturnValue(((opts: {
    search: (prev: Search) => Search;
    replace?: boolean;
  }) => {
    const next = opts.search(search);
    navigations.push({ search: next, replace: opts.replace });
    setSearch(next);
  }) as never);
});

afterEach(() => {
  vi.useRealTimers();
});

const summary = (courseId: string, enrolments: number) => ({
  courseId,
  title: courseId,
  status: 'published' as const,
  enrolments,
  activeThisWeek: 0,
  completionRate: null,
  updatedAt: null,
});

describe('My courses', () => {
  it('validates the filter and search from the address', () => {
    expect(validate({})).toEqual({ status: 'all', q: '' });
    expect(validate({ status: 'draft', q: ' react ' })).toEqual({
      status: 'draft',
      q: 'react',
    });
    expect(validate({ status: 'deleted', q: 5 })).toEqual({
      status: 'all',
      q: '',
    });
    expect(validate({ q: 'a'.repeat(300) }).q).toHaveLength(200);
  });

  it('replaces an invalid or redundant address with the value it fell back to', () => {
    expect(correction({})).toBeUndefined();
    expect(correction({ status: 'draft', q: 'react' })).toBeUndefined();
    expect(correctedTo({ status: 'deleted' })).toEqual({
      status: undefined,
      q: undefined,
    });
    expect(correctedTo({ status: 'all', q: ' react ' })).toEqual({
      status: undefined,
      q: 'react',
    });
  });

  it('keeps a space typed in the search box after the address catches up', async () => {
    const { user } = renderPage({
      'course.listByInstructor': () => ({ items: [], cursor: null }),
    });
    const box = screen.getByLabelText('Search courses');

    await user.type(box, 'intro ');
    await waitFor(() =>
      expect(navigations).toEqual([
        { search: { status: 'all', q: 'intro' }, replace: true },
      ]),
    );
    await user.type(box, 'dyn');

    expect(box).toHaveValue('intro dyn');
  });

  it('follows the address when Back or a link changes the search', async () => {
    renderPage({
      'course.listByInstructor': () => ({ items: [], cursor: null }),
    });
    const box = screen.getByLabelText('Search courses');

    act(() => setSearch({ status: 'all', q: 'streams' }));

    expect(box).toHaveValue('streams');
  });

  it('shows the view the address names', async () => {
    search = { status: 'draft', q: 'advanced' };
    renderPage({
      'course.listByInstructor': () => ({
        items: [
          course('c1', 'Intro to DynamoDB', 'published'),
          course('c2', 'Advanced Queries', 'draft'),
          course('c3', 'Advanced Streams', 'published'),
        ],
        cursor: null,
      }),
    });

    expect(await screen.findByText('Advanced Queries')).toBeInTheDocument();
    expect(screen.queryByText('Advanced Streams')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Search courses')).toHaveValue('advanced');
    expect(
      screen.getByRole('radio', { name: 'Show draft courses' }),
    ).toBeChecked();
  });

  it('pushes the status filter to the address', async () => {
    const { user } = renderPage({
      'course.listByInstructor': () => ({ items: [], cursor: null }),
    });

    await user.click(screen.getByRole('radio', { name: 'Show draft courses' }));

    expect(navigations).toEqual([
      { search: { status: 'draft', q: '' }, replace: undefined },
    ]);
  });

  it('replaces the address once typing in the search box pauses', async () => {
    const { user } = renderPage({
      'course.listByInstructor': () => ({ items: [], cursor: null }),
    });

    await user.type(screen.getByLabelText('Search courses'), 'dyn');
    expect(navigations).toEqual([]);
    await waitFor(() =>
      expect(navigations).toEqual([
        { search: { status: 'all', q: 'dyn' }, replace: true },
      ]),
    );
  });

  it('sets the page title, and hides the count until the list has loaded', () => {
    renderPage({ 'course.listByInstructor': () => new Promise(() => {}) });
    expect(document.title).toBe('My Courses · Discava');
    expect(screen.getByText('Loading your courses…')).toBeVisible();
    expect(screen.queryByText(/courses? shown/)).toBeNull();
  });

  it("shows a spinner, then the instructor's courses from course.listByInstructor", async () => {
    const { calls } = renderPage({
      'course.listByInstructor': () => ({
        items: [
          course('c1', 'Intro to DynamoDB', 'published'),
          course('c2', 'Advanced Queries', 'draft'),
        ],
        cursor: null,
      }),
    });

    expect(
      screen.getByRole('heading', { name: 'My Courses' }),
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByText('Intro to DynamoDB')).toBeInTheDocument(),
    );
    expect(screen.getByText('Advanced Queries')).toBeInTheDocument();
    expect(calls).toEqual([
      {
        path: 'course.listByInstructor',
        input: { instructorId: 'instructor-1', limit: 100 },
      },
    ]);
  });

  it('shows the count and status of each course shown', async () => {
    renderPage({
      'course.listByInstructor': () => ({
        items: [course('c1', 'Intro to DynamoDB', 'published')],
        cursor: null,
      }),
    });

    await waitFor(() =>
      expect(screen.getByText('1 course shown')).toBeInTheDocument(),
    );
    expect(
      screen.getByText('Intro to DynamoDB').closest('[data-slot="card"]'),
    ).toHaveTextContent('Published');
  });

  it('filters the list by status', async () => {
    const { user } = renderPage({
      'course.listByInstructor': () => ({
        items: [
          course('c1', 'Intro to DynamoDB', 'published'),
          course('c2', 'Advanced Queries', 'draft'),
        ],
        cursor: null,
      }),
    });
    await waitFor(() =>
      expect(screen.getByText('Intro to DynamoDB')).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('radio', { name: 'Show draft courses' }));

    expect(screen.queryByText('Intro to DynamoDB')).not.toBeInTheDocument();
    expect(screen.getByText('Advanced Queries')).toBeInTheDocument();
  });

  it('filters the list by a case-insensitive title search', async () => {
    const { user } = renderPage({
      'course.listByInstructor': () => ({
        items: [
          course('c1', 'Intro to DynamoDB', 'published'),
          course('c2', 'Advanced Queries', 'draft'),
        ],
        cursor: null,
      }),
    });
    await waitFor(() =>
      expect(screen.getByText('Intro to DynamoDB')).toBeInTheDocument(),
    );

    await user.type(screen.getByLabelText('Search courses'), 'dynamodb');

    expect(screen.queryByText('Advanced Queries')).not.toBeInTheDocument();
    expect(screen.getByText('Intro to DynamoDB')).toBeInTheDocument();
  });

  it('shows "No courses found" with a way to clear filters, when nothing matches', async () => {
    const { user } = renderPage({
      'course.listByInstructor': () => ({
        items: [course('c1', 'Intro to DynamoDB', 'published')],
        cursor: null,
      }),
    });
    await waitFor(() =>
      expect(screen.getByText('Intro to DynamoDB')).toBeInTheDocument(),
    );

    await user.type(screen.getByLabelText('Search courses'), 'nope');
    expect(screen.getByText('No courses found')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(document.activeElement).toBe(
      screen.getByLabelText('Search courses'),
    );
    expect(screen.getByText('Intro to DynamoDB')).toBeInTheDocument();
  });

  it("shows the API's error when the list fails to load", async () => {
    renderPage({
      'course.listByInstructor': () => {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'Something went wrong');
      },
    });

    expect(
      await screen.findByText("Couldn't load your courses"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Something went wrong on our side. Try again in a moment.',
      ),
    ).toBeInTheDocument();
  });

  it('retries a failed load with Try again', async () => {
    let attempts = 0;
    const { user } = renderPage({
      'course.listByInstructor': () => {
        attempts += 1;
        if (attempts === 1) {
          throw new ApiError('INTERNAL_SERVER_ERROR', 'Something went wrong');
        }
        return {
          items: [course('c1', 'Intro to DynamoDB', 'published')],
          cursor: null,
        };
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Intro to DynamoDB')).toBeInTheDocument();
  });

  it('invites a brand-new instructor to create their first course, not to clear filters', async () => {
    renderPage({
      'course.listByInstructor': () => ({ items: [], cursor: null }),
    });

    expect(
      await screen.findByText("You don't teach any courses yet"),
    ).toBeInTheDocument();
    expect(screen.queryByText('No courses found')).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /Create course/ }),
    ).toHaveLength(2);
  });

  it('links each course to its course page', async () => {
    renderPage({
      'course.listByInstructor': () => ({
        items: [course('c1', 'Intro to DynamoDB', 'published')],
        cursor: null,
      }),
    });

    await screen.findByRole('link', {
      name: 'Open course: Intro to DynamoDB',
    });
    expect(linkProps).toContainEqual({
      to: '/my-courses/$courseId',
      params: { courseId: 'c1' },
    });
  });

  it('shows each course its own enrolments and updated date, with no invented figures', async () => {
    renderPage(
      {
        'course.listByInstructor': () => ({
          items: [
            course(
              'c1',
              'Intro to DynamoDB',
              'published',
              '2026-03-04T10:00:00.000Z',
            ),
            course(
              'c2',
              'Advanced Queries',
              'published',
              '2026-05-20T10:00:00.000Z',
            ),
          ],
          cursor: null,
        }),
      },
      {
        'analytics.courseSummaries': () => [
          summary('c1', 12),
          summary('c2', 40),
        ],
      },
    );

    const first = (await screen.findByText('Intro to DynamoDB')).closest(
      '[data-slot="card"]',
    );
    const second = screen
      .getByText('Advanced Queries')
      .closest('[data-slot="card"]');
    await waitFor(() => expect(first).toHaveTextContent('12'));
    expect(second).toHaveTextContent('40');
    expect(first).toHaveTextContent('4 Mar 2026');
    expect(second).toHaveTextContent('20 May 2026');
    for (const invented of [
      'Semester 2, 2026',
      'Course content coming soon',
      'Updated recently',
      'Ungraded',
      'Modules',
    ]) {
      expect(screen.queryByText(invented)).not.toBeInTheDocument();
    }
  });

  it("counts the summary cards from the courses' statuses", async () => {
    renderPage(
      {
        'course.listByInstructor': () => ({
          items: [
            course('c1', 'One', 'published'),
            course('c2', 'Two', 'published'),
            course('c3', 'Three', 'draft'),
            course('c4', 'Four', 'archived'),
            course('c5', 'Five', 'draft'),
            course('c6', 'Six', 'draft'),
          ],
          cursor: null,
        }),
      },
      {
        'analytics.courseSummaries': () => [summary('c1', 5), summary('c2', 7)],
      },
    );

    const summaryCards = await screen.findByLabelText('Course summary');
    await waitFor(() =>
      expect(summaryCards).toHaveTextContent('12 enrolments in total'),
    );
    const card = (label: string) =>
      screen.getByText(label).closest('[data-slot="card"]');
    expect(card('Active courses')).toHaveTextContent('2');
    expect(card('Draft courses')).toHaveTextContent('3');
    expect(card('Archived courses')).toHaveTextContent('1');
    expect(screen.queryByText('Awaiting grading')).not.toBeInTheDocument();
  });
});
