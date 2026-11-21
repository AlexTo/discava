/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithInstructorApi } from '../../../../../../../test/render-with-instructor-api';

// The breadcrumb needs the portal shell's router and context.
vi.mock('@discava/common-shadcn/components/breadcrumb-label', () => ({
  useBreadcrumbLabel: () => {},
}));
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, {
    // A real Link needs a router; render the target it would link to.
    Link: ({
      to,
      params,
      children,
      ...props
    }: {
      to: string;
      params: Record<string, string>;
      children: React.ReactNode;
    } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a
        href={Object.entries(params).reduce(
          (path, [key, value]) => path.replace(`$${key}`, value),
          to,
        )}
        {...props}
      >
        {children}
      </a>
    ),
  });
});

const { Route } = await import('./index');
const RouteComponent = Route.options.component!;

beforeEach(() => {
  vi.spyOn(Route, 'useParams').mockReturnValue({
    courseId: 'c1',
    contentItemId: 'i1',
  });
});

const row = (n: number, extra = {}) => ({
  userId: `u${n}`,
  displayName: `Student ${n}`,
  enrolled: true,
  state: 'submitted',
  submittedAt: new Date(Date.now() - n * 86_400_000).toISOString(),
  version: 1,
  ...extra,
});

const page = (rows: unknown[], extra = {}) => ({
  assignment: { title: 'Essay', maxPoints: 20 },
  counts: {
    waiting: 2,
    resubmissionRequested: 1,
    returned: 3,
    notSubmitted: 4,
  },
  rows,
  ...extra,
});

const render = (list: (input: unknown) => unknown) =>
  renderWithInstructorApi(<RouteComponent />, {
    handlers: { 'assignmentSubmission.list': list },
  });

describe('Submissions list', () => {
  it('shows the header, count chips and rows in the order given', async () => {
    render(() => page([row(3), row(1, { late: true })]));

    expect(await screen.findByRole('heading', { name: 'Essay' })).toBeVisible();
    expect(screen.getByText(/Out of 20 points/)).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Back to course' }),
    ).toHaveAttribute('href', '/my-courses/c1');
    const chips = screen.getByRole('list', { name: 'Submission counts' });
    expect(within(chips).getByText('Waiting 2')).toBeVisible();
    expect(within(chips).getByText('Resubmission requested 1')).toBeVisible();
    expect(within(chips).getByText('Returned 3')).toBeVisible();
    expect(within(chips).getByText('Not submitted 4')).toBeVisible();

    const links = screen.getAllByRole('link', { name: /^Student/ });
    expect(links.map((l) => l.textContent)).toEqual(['Student 3', 'Student 1']);
    expect(links[0]).toHaveAttribute(
      'href',
      '/my-courses/c1/assignments/i1/submissions/u3',
    );
    expect(screen.getAllByText('Late')).toHaveLength(1);
  });

  it('shows points, and the badge for a student who left', async () => {
    render(() =>
      page([
        row(1, { state: 'returned', points: 17, pointsOutOf: 20 }),
        row(2, { enrolled: false }),
      ]),
    );

    expect(await screen.findByText('17 / 20')).toBeVisible();
    expect(screen.getByText('Returned', { selector: 'td' })).toBeVisible();
    expect(screen.getByText('No longer enrolled')).toBeVisible();
  });

  it('pages with Load more', async () => {
    const inputs: unknown[] = [];
    const { user } = render((input) => {
      inputs.push(input);
      return (input as { cursor?: string }).cursor
        ? page([row(2)])
        : page([row(1)], { nextCursor: 'next' });
    });

    await user.click(await screen.findByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Student 2')).toBeVisible();
    expect(screen.getByText('Student 1')).toBeVisible();
    expect(inputs[1]).toMatchObject({ cursor: 'next' });
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('says so when nobody is enrolled', async () => {
    render(() => page([]));

    expect(
      await screen.findByText('No students are enrolled yet'),
    ).toBeVisible();
  });

  it('shows an error with Try again', async () => {
    render(() => {
      throw new Error('boom');
    });

    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});
