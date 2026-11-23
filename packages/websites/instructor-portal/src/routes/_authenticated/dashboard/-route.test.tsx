/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../test/render-with-instructor-api';

// Link needs a router context this test doesn't set up; a plain anchor, its
// `to` and `params` kept as the href, shows where each card leads.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, {
    Link: ({
      children,
      to,
      params,
      className,
    }: {
      children: React.ReactNode;
      to: string;
      params?: Record<string, string>;
      className?: string;
    }) => (
      <a
        href={Object.entries(params ?? {}).reduce(
          (path, [name, value]) => path.replace(`$${name}`, value),
          to,
        )}
        className={className}
      >
        {children}
      </a>
    ),
  });
});

const { Route } = await import('./route');
const RouteComponent = Route.options.component!;

const summary = (overrides: Record<string, unknown> = {}) => ({
  courseId: 'c1',
  title: 'Intro to DynamoDB',
  status: 'published',
  enrolments: 12,
  activeThisWeek: 5,
  completionRate: 30,
  updatedAt: '2026-11-17T08:30:00.000Z',
  ...overrides,
});

const renderPage = (courseSummaries: () => unknown) =>
  renderWithInstructorApi(<RouteComponent />, {
    handlers: { 'analytics.courseSummaries': courseSummaries },
  });

describe('Dashboard', () => {
  it('sets the page title', () => {
    renderPage(() => new Promise(() => {}));
    expect(document.title).toBe('Dashboard · Discava');
  });

  it('shows skeletons while the figures load', () => {
    renderPage(() => new Promise(() => {}));

    expect(
      screen.getByRole('heading', { name: 'Dashboard' }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId('course-card-skeleton')).toHaveLength(3);
  });

  it('reads analytics.courseSummaries, and nothing else', async () => {
    const { calls } = renderPage(() => [summary()]);

    await screen.findByText('Intro to DynamoDB');
    expect(calls.map(({ path }) => path)).toEqual([
      'analytics.courseSummaries',
    ]);
  });

  it('invites creating a course when there are none', async () => {
    renderPage(() => []);

    expect(
      await screen.findByText("You don't teach any courses yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Create a course' }),
    ).toHaveAttribute('href', '/my-courses');
  });

  it('shows a card per course with its figures', async () => {
    renderPage(() => [
      summary(),
      summary({
        courseId: 'c2',
        title: 'Advanced Queries',
        status: 'draft',
        enrolments: 0,
        activeThisWeek: 0,
        completionRate: null,
        updatedAt: null,
      }),
    ]);

    const first = (await screen.findByText('Intro to DynamoDB')).closest('a')!;
    expect(within(first).getByText('Published')).toBeInTheDocument();
    expect(within(first).getByText('Enrolments').nextSibling).toHaveTextContent(
      '12',
    );
    expect(
      within(first).getByText('Active this week').nextSibling,
    ).toHaveTextContent('5');
    expect(
      within(first).getByText('Completion rate').nextSibling,
    ).toHaveTextContent('30%');
    expect(within(first).getByText(/^Last updated /)).toBeInTheDocument();

    const second = screen.getByText('Advanced Queries').closest('a')!;
    expect(within(second).getByText('Draft')).toBeInTheDocument();
    expect(
      within(second).getByText('Enrolments').nextSibling,
    ).toHaveTextContent('0');
    expect(
      within(second).getByText('Completion rate').nextSibling,
    ).toHaveTextContent('No data');
    expect(within(second).getByText('No activity yet')).toBeInTheDocument();
    expect(within(second).queryByText(/Last updated/)).toBeNull();
  });

  it('links each card to the course’s analytics', async () => {
    renderPage(() => [summary(), summary({ courseId: 'c2', title: 'Other' })]);

    const card = (await screen.findByText('Intro to DynamoDB')).closest('a')!;
    expect(card).toHaveAttribute('href', '/dashboard/c1');
    expect(screen.getByText('Other').closest('a')).toHaveAttribute(
      'href',
      '/dashboard/c2',
    );
  });

  it('shows the error with a Retry that asks again', async () => {
    let attempts = 0;
    const { user } = renderPage(() => {
      attempts++;
      if (attempts === 1) {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'Something went wrong');
      }
      return [summary()];
    });

    expect(
      await screen.findByText("Couldn't load your courses"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Something went wrong on our side. Try again in a moment.',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Intro to DynamoDB')).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it('no longer shows placeholder figures or their disclaimer', async () => {
    renderPage(() => [summary()]);

    await screen.findByText('Intro to DynamoDB');
    expect(screen.queryByText(/illustrative placeholders/i)).toBeNull();
    expect(screen.queryByText('Enrolled students')).toBeNull();
    expect(screen.queryByText('At-risk students')).toBeNull();
    expect(screen.queryByText(/Weekly enrollment/i)).toBeNull();
  });
});
