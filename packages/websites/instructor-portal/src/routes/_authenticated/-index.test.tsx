/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { RuntimeConfigContext } from '@discava/common-web-utils/runtime-config';
import { ApiError, fakeTrpcFetch } from '@discava/common-web-utils/testing';
import type { AppRouter as CoreApiRouter } from '@discava/core-api';
import type { AppRouter as InstructorApiRouter } from '@discava/instructor-api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoreApiTRPCContext, InstructorApiTRPCContext } from '../../api';

const authProfile = vi.hoisted(() => ({
  current: {} as Record<string, string | undefined>,
}));
vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { profile: authProfile.current } }),
}));
// Link needs a router context this test doesn't set up; a plain anchor, its
// `to`/`params` captured instead, keeps the page's own logic testable.
const linkProps = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, {
    Link: ({
      children,
      to,
      params,
    }: {
      children: React.ReactNode;
      to: string;
      params?: Record<string, unknown>;
    }) => {
      linkProps.push({ to, params });
      return <a href="#">{children}</a>;
    },
    // CreateCourseDialog navigates on save; not under test here (see
    // create-course-dialog.test.tsx).
    useNavigate: () => vi.fn(),
  });
});

const { Route } = await import('./index');
const RouteComponent = Route.options.component!;

const course = (
  courseId: string,
  title: string,
  status: 'draft' | 'published' | 'archived',
  imageKey?: string,
) => ({ courseId, title, description: '', imageKey, status });

const emptyQueue = { 'gradingQueue.list': () => ({ total: 0, items: [] }) };

const renderPage = (coreHandlers = {}, instructorHandlers = emptyQueue) => {
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
  const instructorCalls: { path: string; input: unknown }[] = [];
  const instructorClient = createTRPCClient<InstructorApiRouter>({
    links: [
      httpLink({
        url: 'http://instructor-api.test/',
        fetch: fakeTrpcFetch(instructorHandlers, instructorCalls),
      }),
    ],
  });
  const result = render(
    <RuntimeConfigContext.Provider
      value={{ media: { PublicMediaBucket: 'https://media.test/' } }}
    >
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
  return { ...result, calls, instructorCalls };
};

const listing = (items: ReturnType<typeof course>[]) => ({
  'course.listByInstructor': () => ({ items, cursor: null }),
});

const sampleStrings = [
  'Applied Mathematics',
  'Foundations of Biology',
  'Academic Communication',
  'Mia Chen',
  'Oliver Smith',
  '33 submissions',
  'Needs attention',
  'Recent activity',
  'Upcoming',
  'Open grading queue',
  'Create an assignment',
];

beforeEach(() => {
  linkProps.length = 0;
  authProfile.current = { sub: 'instructor-1' };
});

describe('Instructor home: real courses', () => {
  it('lists the non-archived courses with status, in returned order, each linking to its editor', async () => {
    const { calls } = renderPage(
      listing([
        course('c1', 'Draft course', 'draft'),
        course('c2', 'Published one', 'published'),
        course('c3', 'Archived course', 'archived'),
        course('c4', 'Published two', 'published'),
      ]),
    );

    await screen.findByText('Draft course');
    expect(screen.queryByText('Archived course')).not.toBeInTheDocument();
    const titles = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(titles).toEqual(['Draft course', 'Published one', 'Published two']);
    expect(
      screen.getByText('Draft course').closest('[data-slot="card"]'),
    ).toHaveTextContent('Draft');
    expect(
      screen.getByText('Published one').closest('[data-slot="card"]'),
    ).toHaveTextContent('Published');
    for (const courseId of ['c1', 'c2', 'c4']) {
      expect(linkProps).toContainEqual({
        to: '/my-courses/$courseId',
        params: { courseId },
      });
    }
    expect(linkProps).not.toContainEqual({
      to: '/my-courses/$courseId',
      params: { courseId: 'c3' },
    });
    expect(calls).toEqual([
      {
        path: 'course.listByInstructor',
        input: { instructorId: 'instructor-1', limit: 100 },
      },
    ]);
  });

  it('shows only six courses and links to all of them', async () => {
    renderPage(
      listing(
        Array.from({ length: 7 }, (_, index) =>
          course(`c${index}`, `Course ${index}`, 'published'),
        ),
      ),
    );

    await screen.findByText('Course 0');
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(6);
    expect(screen.queryByText('Course 6')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'View all courses' }),
    ).toBeVisible();
    expect(linkProps).toContainEqual({ to: '/my-courses', params: undefined });
  });

  it('shows the empty state with a Create a course action when there are none', async () => {
    renderPage(listing([course('c1', 'Old one', 'archived')]));

    expect(
      await screen.findByText("You don't teach any courses yet"),
    ).toBeVisible();
    expect(
      screen.getAllByRole('button', { name: 'Create a course' }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('Old one')).not.toBeInTheDocument();
  });

  it('shows a placeholder for a course without an image and the image when it has one', async () => {
    const { container } = renderPage(
      listing([
        course('c1', 'No image', 'draft'),
        course('c2', 'With image', 'draft', 'courses/c2.png'),
      ]),
    );

    await screen.findByText('No image');
    const plain = screen.getByText('No image').closest('[data-slot="card"]')!;
    expect(plain.querySelector('img')).toBeNull();
    expect(
      plain.querySelector('[data-testid="course-placeholder"]'),
    ).not.toBeNull();
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://media.test/courses/c2.png',
    );
  });

  it('does not request the list before the signed-in user is known', async () => {
    authProfile.current = {};
    const { calls } = renderPage(listing([]));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toEqual([]);
    expect(
      screen.queryByText("You don't teach any courses yet"),
    ).not.toBeInTheDocument();
  });
});

describe('Instructor home: nothing invented', () => {
  it.each([
    ['courses', [course('c1', 'Real course', 'published')]],
    ['no courses', []],
  ])(
    'contains none of the sample content for an instructor with %s',
    async (_, items) => {
      const { container } = renderPage(listing(items));

      await waitFor(() =>
        expect(
          screen.queryByText('Real course') ??
            screen.queryByText("You don't teach any courses yet"),
        ).toBeInTheDocument(),
      );
      for (const sample of sampleStrings) {
        expect(container).not.toHaveTextContent(sample);
      }
      expect(container).not.toHaveTextContent(/students/i);
      expect(container).not.toHaveTextContent(/to grade/i);
    },
  );

  it('summarises the number of non-archived courses only', async () => {
    renderPage(
      listing([
        course('c1', 'One', 'published'),
        course('c2', 'Two', 'draft'),
        course('c3', 'Three', 'archived'),
      ]),
    );

    const summary = await screen.findByLabelText('Teaching overview');
    expect(summary).toHaveTextContent('2');
    expect(summary).toHaveTextContent('Courses');
    expect(summary).not.toHaveTextContent('3');
  });

  it("greets the instructor by their profile's first name", async () => {
    authProfile.current = {
      sub: 'instructor-1',
      given_name: 'Priya',
      family_name: 'Nair',
    };
    renderPage(listing([]));

    expect(
      await screen.findByRole('heading', { name: 'Welcome back, Priya' }),
    ).toBeVisible();
  });

  it('greets neutrally when the profile has no name', async () => {
    renderPage(listing([]));

    expect(
      await screen.findByRole('heading', { name: 'Welcome back' }),
    ).toBeVisible();
    expect(screen.queryByText(/Alex/)).not.toBeInTheDocument();
  });

  it('makes no claim about submissions in its introduction', async () => {
    const { container } = renderPage(listing([]));

    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(container).not.toHaveTextContent(/submission/i);
  });
});

describe('Instructor home: loading and failure', () => {
  it('sets the page title', () => {
    renderPage(listing([]));
    expect(document.title).toBe('Home · Discava');
  });

  it('shows a spinner, and neither the empty state nor courses, while the list loads', async () => {
    renderPage({
      'course.listByInstructor': () => new Promise(() => {}),
    });

    expect(await screen.findByText('Loading your courses…')).toBeVisible();
    expect(
      screen.queryByText("You don't teach any courses yet"),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });

  it('shows a spinner, not the empty state, while the signed-in user is unknown', async () => {
    authProfile.current = {};
    renderPage(listing([]));

    expect(screen.getByText('Loading your courses…')).toBeVisible();
    expect(
      screen.queryByText("You don't teach any courses yet"),
    ).not.toBeInTheDocument();
  });

  it('shows an error with Try again, not the empty state, when the request fails, and recovers on retry', async () => {
    const user = userEvent.setup();
    let fail = true;
    const { calls } = renderPage({
      'course.listByInstructor': () => {
        if (fail) {
          throw new ApiError('INTERNAL_SERVER_ERROR', 'Something went wrong');
        }
        return {
          items: [course('c1', 'Back again', 'published')],
          cursor: null,
        };
      },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load your courses",
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(
      screen.queryByText("You don't teach any courses yet"),
    ).not.toBeInTheDocument();
    expect(calls).toHaveLength(1);

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Back again')).toBeVisible();
    expect(calls).toHaveLength(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

const queueItem = (userId: string, name: string, courseId = 'c1') => ({
  courseId,
  courseTitle: `Course ${courseId}`,
  contentItemId: 'item-1',
  assignmentTitle: 'Essay',
  userId,
  displayName: name,
  submittedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
  late: false,
});

describe('Instructor home: waiting for grading', () => {
  it('shows the total and a row per entry linking to its review page', async () => {
    const { instructorCalls } = renderPage(listing([]), {
      'gradingQueue.list': () => ({
        total: 12,
        items: [queueItem('u1', 'Ada'), queueItem('u2', 'Grace', 'c2')],
      }),
    });

    expect(await screen.findByText('Ada')).toBeVisible();
    expect(screen.getByText('Grace')).toBeVisible();
    expect(screen.getByText('12')).toBeVisible();
    expect(screen.getAllByText(/Waited 3 days ago/)).toHaveLength(2);
    expect(linkProps).toContainEqual({
      to: '/my-courses/$courseId/assignments/$contentItemId/submissions/$userId',
      params: { courseId: 'c2', contentItemId: 'item-1', userId: 'u2' },
    });
    expect(instructorCalls).toEqual([
      { path: 'gradingQueue.list', input: { limit: 10 } },
    ]);
  });

  it('says so when nothing is waiting', async () => {
    renderPage(listing([]));

    expect(
      await screen.findByText('Nothing is waiting for grading.'),
    ).toBeVisible();
  });

  it('shows an error with a retry when the queue fails to load', async () => {
    renderPage(listing([]), {
      'gradingQueue.list': () => {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'Queue broke');
      },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load the grading queue",
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('shows a loading note while the queue loads', async () => {
    renderPage(listing([]), {
      'gradingQueue.list': () => new Promise(() => {}),
    });

    expect(await screen.findByText(/Loading the grading queue/)).toBeVisible();
  });
});
