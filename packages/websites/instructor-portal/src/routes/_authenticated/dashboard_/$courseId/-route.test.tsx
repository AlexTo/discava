/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../test/render-with-instructor-api';

// The page reads its params and search from the router, and sets its
// breadcrumb from the location; neither has a router here.
let search: { days: 30 | 90 } = { days: 90 };
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, {
    useLocation: () => ({ pathname: '/dashboard/c1' }),
    // A real Link needs a router; render the target it would link to.
    Link: ({
      search,
      children,
      ...props
    }: {
      search?: { days: number };
      children: React.ReactNode;
    } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a href={search ? `?days=${search.days}` : '/dashboard'} {...props}>
        {children}
      </a>
    ),
  });
});

const { Route } = await import('./route');
const RouteComponent = Route.options.component!;

beforeEach(() => {
  search = { days: 90 };
  vi.spyOn(Route, 'useParams').mockReturnValue({ courseId: 'c1' });
  vi.spyOn(Route, 'useSearch').mockImplementation(() => search as never);
});

const dayList = (days: number) =>
  Array.from({ length: days }, (_, i) => ({
    date: new Date(Date.UTC(2026, 10, 17) - (days - 1 - i) * 86_400_000)
      .toISOString()
      .slice(0, 10),
    enrolments: i === days - 1 ? 2 : 0,
    activeLearners: i === days - 1 ? 3 : 0,
  }));

const lesson = (
  lessonId: string,
  started: number,
  completed: number,
  completionShare: number | null,
) => ({
  lessonId,
  moduleId: 'm1',
  title: `Lesson ${lessonId}`,
  started,
  completed,
  completionShare,
});

const analytics = ({
  days = 90,
  lessons = [] as unknown[],
  quizzes = [] as unknown[],
  videoQuestions = [] as unknown[],
  modulesWithoutQuestions = [] as unknown[],
  ...totals
}: Record<string, unknown> = {}) => ({
  totals: {
    enrolments: 10,
    active: 5,
    completed: 4,
    dropped: 1,
    completionRate: 44,
    activeThisWeek: 6,
    updatedAt: '2026-11-17T08:30:00.000Z',
    ...totals,
  },
  daily: dayList(days as number),
  lessons,
  quizzes,
  videoQuestions,
  modulesWithoutQuestions,
});

const renderPage = (course: (input: unknown) => unknown = () => analytics()) =>
  renderWithInstructorApi(<RouteComponent />, {
    handlers: {
      'analytics.course': course,
      'analytics.courseSummaries': () => [
        { courseId: 'c1', title: 'Intro to DynamoDB' },
      ],
    },
  });

describe('Course analytics', () => {
  it('validates the range from the URL, defaulting to 90 days', () => {
    const validate = Route.options.validateSearch as (
      search: Record<string, unknown>,
    ) => { days: number };
    expect(validate({})).toEqual({ days: 90 });
    expect(validate({ days: 30 })).toEqual({ days: 30 });
    expect(validate({ days: '30' })).toEqual({ days: 30 });
    expect(validate({ days: 7 })).toEqual({ days: 90 });
  });

  it('shows the title, when the figures last changed and the totals', async () => {
    renderPage();

    expect(
      // The title comes from a second request; CI runs every project's tests
      // at once, so it can take longer than findBy's default second.
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Intro to DynamoDB' },
        { timeout: 5_000 },
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText(/^Last updated /)).toBeInTheDocument();
    const totals = within(screen.getByLabelText('Totals'));
    for (const [label, value] of [
      ['Enrolments', '10'],
      ['Active', '5'],
      ['Completed', '4'],
      ['Dropped', '1'],
      ['Completion rate', '44%'],
      ['Active this week', '6'],
    ]) {
      expect(totals.getByText(label).nextSibling).toHaveTextContent(
        new RegExp(`^${value}$`),
      );
    }
  });

  it('asks for the range in the URL', async () => {
    search = { days: 30 };
    const { calls } = renderPage(() => analytics({ days: 30 }));

    await screen.findByText(/^Last updated /);
    expect(
      calls.find(({ path }) => path === 'analytics.course')?.input,
    ).toEqual({ courseId: 'c1', days: 30 });
  });

  it('marks the chosen range, and links the others through the search params', async () => {
    renderPage();

    await screen.findByText(/^Last updated /);
    expect(screen.getByRole('link', { name: '90 days' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    const other = screen.getByRole('link', { name: '30 days' });
    expect(other).not.toHaveAttribute('aria-current');
    expect(other).toHaveAttribute('href', '?days=30');
  });

  it('charts new enrolments and active learners per day, with tables as text alternatives', async () => {
    renderPage();

    const enrolments = await screen.findByRole('table', {
      name: 'New enrolments per day',
    });
    expect(within(enrolments).getAllByRole('row')).toHaveLength(91);
    expect(
      within(enrolments).getByRole('row', { name: /2026-11-17/ }),
    ).toHaveTextContent('2');

    const active = screen.getByRole('table', {
      name: 'Active learners per day',
    });
    expect(
      within(active).getByRole('row', { name: /2026-11-17/ }),
    ).toHaveTextContent('3');
  });

  it('invites learners when none have enrolled', async () => {
    renderPage(() =>
      analytics({
        enrolments: 0,
        active: 0,
        completed: 0,
        dropped: 0,
        completionRate: null,
        activeThisWeek: 0,
        updatedAt: null,
      }),
    );

    expect(
      await screen.findByText('No learners have enrolled yet'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });

  it('shows the not-found page for a course the caller does not teach', async () => {
    renderPage(() => {
      throw new ApiError('NOT_FOUND', 'NOT_FOUND');
    });

    expect(await screen.findByText('Course not found')).toBeInTheDocument();
    expect(
      screen.getByText(
        "This course doesn't exist, or you don't have access to it.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Enrolments')).toBeNull();
  });

  it('keeps one h1 and the fallback title while loading', async () => {
    renderPage(() => new Promise(() => {}) as never);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(document.title).toBe('Course analytics · Discava');
  });

  it('titles the page with the course once the summaries answer', async () => {
    renderPage();
    await waitFor(() =>
      expect(document.title).toBe('Intro to DynamoDB · Dashboard · Discava'),
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('keeps one h1, and links back to the dashboard, when the course is not found', async () => {
    renderPage(() => {
      throw new ApiError('NOT_FOUND', 'NOT_FOUND');
    });
    expect(await screen.findByText('Course not found')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('link', { name: 'Back to the dashboard' }),
    ).toHaveAttribute('href', '/dashboard');
  });

  it('shows other errors with a Retry that asks again', async () => {
    let attempts = 0;
    const { user } = renderPage(() => {
      attempts++;
      if (attempts === 1) {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'Something went wrong');
      }
      return analytics();
    });

    expect(
      await screen.findByText("Couldn't load the analytics"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(/^Last updated /)).toBeInTheDocument();
  });

  describe('lesson drop-off', () => {
    const lessons = [
      lesson('a', 4, 4, 100),
      lesson('b', 4, 1, 25),
      lesson('c', 0, 0, null),
    ];

    it('shows a bar per lesson in course order, with its share or No data', async () => {
      renderPage(() => analytics({ lessons }));

      const list = await screen.findByRole('list', {
        name: 'Lessons in course order',
      });
      const rows = within(list).getAllByRole('listitem');
      expect(rows.map((row) => row.textContent)).toEqual([
        expect.stringContaining('Lesson a'),
        expect.stringContaining('Lesson b'),
        expect.stringContaining('Lesson c'),
      ]);
      expect(rows[0]).toHaveTextContent('100%');
      expect(rows[1]).toHaveTextContent('25%');
      expect(rows[2]).toHaveTextContent('No data');
    });

    it('always shows the numbers of a lesson, and keeps rows out of the tab order', async () => {
      renderPage(() => analytics({ lessons }));

      const list = await screen.findByRole('list', {
        name: 'Lessons in course order',
      });
      const rows = within(list).getAllByRole('listitem');
      expect(rows[1]).toHaveTextContent('4 started, 1 completed');
      expect(rows[2]).toHaveTextContent('Nobody has started this lesson');
      for (const row of rows) {
        expect(row).not.toHaveAttribute('tabindex');
        expect(row.querySelector('p')?.className).not.toContain('opacity-0');
      }
    });

    it('marks the lowest share, and only that', async () => {
      renderPage(() => analytics({ lessons }));

      const list = await screen.findByRole('list', {
        name: 'Lessons in course order',
      });
      const rows = within(list).getAllByRole('listitem');
      expect(rows[1]).toHaveTextContent('Lowest completion');
      expect(within(list).getAllByText('Lowest completion')).toHaveLength(1);
    });

    it('marks nothing when only one lesson has a share', async () => {
      renderPage(() =>
        analytics({
          lessons: [lesson('a', 2, 1, 50), lesson('c', 0, 0, null)],
        }),
      );

      await screen.findByRole('list', { name: 'Lessons in course order' });
      expect(screen.queryByText('Lowest completion')).toBeNull();
    });

    it('says so when no lesson is shown', async () => {
      renderPage(() => analytics({ lessons: [] }));

      expect(
        await screen.findByText('No lessons are shown to learners yet.'),
      ).toBeInTheDocument();
    });

    it('waits for the first enrolment, as the rest of the page does', async () => {
      renderPage(() => analytics({ enrolments: 0, lessons }));

      await screen.findByText('No learners have enrolled yet');
      expect(screen.queryByText('Lesson drop-off')).toBeNull();
    });
  });

  describe('quizzes', () => {
    const quizzes = [
      { contentItemId: 'q-a', lessonId: 'l1', title: 'Warm-up', students: 3 },
      { contentItemId: 'q-b', lessonId: 'l2', title: 'Final', students: 0 },
    ];

    it('shows a panel for each quiz, in the order given', async () => {
      renderPage(() => analytics({ quizzes }));

      const section = await screen.findByLabelText('Quizzes');
      const panels = within(section).getAllByRole('article');
      expect(panels.map((panel) => panel.textContent)).toEqual([
        expect.stringContaining('Warm-up'),
        expect.stringContaining('Final'),
      ]);
    });

    it('opens one quiz’s analysis, asking for that quiz only', async () => {
      const { user, calls } = renderWithInstructorApi(<RouteComponent />, {
        handlers: {
          'analytics.course': () => analytics({ quizzes }),
          'analytics.courseSummaries': () => [],
          'analytics.quiz': () => ({
            questions: [
              {
                questionId: 'q1',
                text: 'What is a partition key?',
                attempts: 6,
                misses: 3,
                missRate: 50,
                ranked: true,
              },
            ],
            scoreBands: Array.from({ length: 10 }, (_, band) => ({
              from: band * 10,
              to: band === 9 ? 100 : band * 10 + 9,
              students: band === 7 ? 3 : 0,
            })),
            students: 3,
          }),
        },
      });

      const [first] = await screen.findAllByRole('button', {
        name: /Show analysis/,
      });
      await user.click(first);

      expect(
        await screen.findByText('What is a partition key?'),
      ).toBeInTheDocument();
      expect(
        calls
          .filter(({ path }) => path === 'analytics.quiz')
          .map(({ input }) => input),
      ).toEqual([{ courseId: 'c1', contentItemId: 'q-a' }]);
    });

    it('has no quiz section for a course without shown quizzes', async () => {
      renderPage(() => analytics({ quizzes: [] }));

      await screen.findByText(/^Last updated /);
      expect(screen.queryByLabelText('Quizzes')).toBeNull();
    });

    it('waits for the first enrolment, as the rest of the page does', async () => {
      renderPage(() => analytics({ enrolments: 0, quizzes }));

      await screen.findByText('No learners have enrolled yet');
      expect(screen.queryByText('Warm-up')).toBeNull();
    });
  });
});
