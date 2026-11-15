/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AppRouter as CoreApiRouter } from '@discava/core-api';
import type { AppRouter as InstructorApiRouter } from '@discava/instructor-api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoreApiTRPCContext } from '../../../components/CoreApiClientProvider';
import { InstructorApiTRPCContext } from '../../../components/InstructorApiClientProvider';
import { RuntimeConfigContext } from '../../../components/RuntimeConfig';
import { ApiError, fakeFetch } from '../../../test/fake-trpc-fetch';

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { profile: { sub: 'instructor-1' } } }),
}));
// Link needs a router context this test doesn't set up; a plain anchor, its
// `to`/`params` captured instead, keeps the course list's own logic testable.
const linkProps = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({
      children,
      to,
      params,
    }: {
      children: React.ReactNode;
      to: string;
      params: Record<string, unknown>;
    }) => {
      linkProps.push({ to, params });
      return <a href="#">{children}</a>;
    },
    // CreateCourseDialog navigates on save, which also needs a router this
    // test doesn't set up; not under test here (see create-course-dialog.test.tsx).
    useNavigate: () => vi.fn(),
  };
});

const { Route } = await import('./route');
const RouteComponent = Route.options.component!;

const course = (
  courseId: string,
  title: string,
  status: 'draft' | 'published' | 'archived',
) => ({
  courseId,
  title,
  description: '',
  imageKey: undefined,
  status,
});

// The page itself reads from core-api, but also renders CreateCourseDialog,
// which calls useInstructorApi() as soon as it mounts (to set up its create
// mutation) even before it's opened, so both APIs need a context here.
const renderPage = (coreHandlers = {}) => {
  const calls: { path: string; input: unknown }[] = [];
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const coreClient = createTRPCClient<CoreApiRouter>({
    links: [
      httpLink({
        url: 'http://core-api.test/',
        fetch: fakeFetch(coreHandlers, calls),
      }),
    ],
  });
  const instructorClient = createTRPCClient<InstructorApiRouter>({
    links: [
      httpLink({
        url: 'http://instructor-api.test/',
        fetch: fakeFetch({}, []),
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

beforeEach(() => {
  linkProps.length = 0;
});

describe('My courses', () => {
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
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('links each course to its course page', async () => {
    renderPage({
      'course.listByInstructor': () => ({
        items: [course('c1', 'Intro to DynamoDB', 'published')],
        cursor: null,
      }),
    });

    await screen.findByRole('link', { name: 'Open course' });
    expect(linkProps).toContainEqual({
      to: '/my-courses/$courseId',
      params: { courseId: 'c1' },
    });
  });
});
