/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../test/render-with-instructor-api';

// The page reads its params and search from the router, and sets its
// breadcrumb from the location; neither has a router here.
let search: { days: 30 | 90 } = { days: 90 };
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useLocation: () => ({ pathname: '/dashboard/c1' }),
    // A real Link needs a router; render the target it would link to.
    Link: ({
      search,
      children,
      ...props
    }: {
      search: { days: number };
      children: React.ReactNode;
    } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a href={`?days=${search.days}`} {...props}>
        {children}
      </a>
    ),
  };
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

const analytics = ({ days = 90, ...totals }: Record<string, unknown> = {}) => ({
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
  lessons: [],
  quizzes: [],
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
      await screen.findByRole('heading', {
        level: 1,
        name: 'Intro to DynamoDB',
      }),
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
});
