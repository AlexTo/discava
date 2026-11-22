/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  type Handler,
  renderWithCoreApi,
} from '../../../../test/render-with-core-api';
import { CourseReviews } from './reviews';

const stars = { 1: 0, 2: 0, 3: 1, 4: 3, 5: 8 };

const review = (overrides: Record<string, unknown> = {}) => ({
  reviewerName: 'Ada L.',
  rating: 5,
  text: 'Clear and rigorous.',
  createdAt: '2026-10-05T12:00:00.000Z',
  ...overrides,
});

const render = (
  handlers: Record<string, Handler> = {},
  { signedIn = false } = {},
) =>
  renderWithCoreApi(<CourseReviews courseId="course-1" />, {
    signedIn,
    handlers: {
      'review.summary': () => ({ count: 12, average: 4.6, stars }),
      'review.list': () => ({ items: [review()], cursor: null }),
      'course.myEnrolment': () => null,
      'review.mine': () => null,
      ...handlers,
    },
  });

describe('CourseReviews', () => {
  it('shows "No ratings yet" and no breakdown for an unrated course', async () => {
    render({
      'review.summary': () => ({
        count: 0,
        stars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      }),
      'review.list': () => ({ items: [], cursor: null }),
    });

    expect(await screen.findByText('No ratings yet')).toBeInTheDocument();
    expect(await screen.findByText('No reviews yet')).toBeInTheDocument();
    expect(screen.queryByLabelText('Ratings breakdown')).toBeNull();
  });

  it('shows the average, count and five-row breakdown of a rated course', async () => {
    render();

    expect(await screen.findByText('4.6')).toBeInTheDocument();
    expect(screen.getByText('(12 ratings)')).toBeInTheDocument();
    const rows = within(
      screen.getByLabelText('Ratings breakdown'),
    ).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      '5 stars8',
      '4 stars3',
      '3 stars1',
      '2 stars0',
      '1 star0',
    ]);
  });

  it('lists reviews with name, stars, date, edited mark and instructor response', async () => {
    render({
      'review.list': () => ({
        items: [
          review({
            editedAt: '2026-10-06T12:00:00.000Z',
            response: {
              text: 'Thank you!',
              byName: 'Prof. Grace',
              at: '2026-10-07T12:00:00.000Z',
            },
          }),
        ],
        cursor: null,
      }),
    });

    expect(await screen.findByText('Ada L.')).toBeInTheDocument();
    expect(screen.getByText('Clear and rigorous.')).toBeInTheDocument();
    expect(screen.getByText(/· edited/)).toBeInTheDocument();
    expect(screen.getByText('Response from Prof. Grace')).toBeInTheDocument();
    expect(screen.getByText('Thank you!')).toBeInTheDocument();
  });

  it('fetches the next page when Load more is pressed', async () => {
    const { user, calls } = render({
      'review.list': (input) =>
        (input as { cursor?: string }).cursor
          ? { items: [review({ reviewerName: 'Bob K.' })], cursor: null }
          : { items: [review()], cursor: 'next' },
    });

    await user.click(await screen.findByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Bob K.')).toBeInTheDocument();
    expect(screen.getByText('Ada L.')).toBeInTheDocument();
    expect(
      calls.filter(({ path }) => path === 'review.list').map((c) => c.input),
    ).toEqual([
      expect.objectContaining({ courseId: 'course-1', limit: 10 }),
      expect.objectContaining({
        courseId: 'course-1',
        limit: 10,
        cursor: 'next',
      }),
    ]);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('shows markup in review text as text and keeps line breaks', async () => {
    render({
      'review.list': () => ({
        items: [review({ text: '<b>bold</b>\nsecond line' })],
        cursor: null,
      }),
    });

    const text = await screen.findByText(/second line/);
    expect(text.textContent).toBe('<b>bold</b>\nsecond line');
    expect(text.querySelector('b')).toBeNull();
    expect(text).toHaveClass('whitespace-pre-line');
  });

  it('invites an enrolled student to write the first review', async () => {
    render(
      {
        'review.list': () => ({ items: [], cursor: null }),
        'course.myEnrolment': () => ({
          courseId: 'course-1',
          userId: 'student-1',
          status: 'active',
          progressPercent: 0,
        }),
      },
      { signedIn: true },
    );

    expect(
      await screen.findByText('Be the first to review this course'),
    ).toBeInTheDocument();
  });

  it('shows an error with a retry that loads the list', async () => {
    let attempts = 0;
    const { user } = render({
      'review.list': () => {
        attempts += 1;
        if (attempts === 1) {
          throw new ApiError('INTERNAL_SERVER_ERROR', 'Reviews are down');
        }
        return { items: [review()], cursor: null };
      },
    });

    expect(
      await screen.findByText(
        'Something went wrong on our side. Try again in a moment.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Ada L.')).toBeInTheDocument();
  });

  it('shows no user id or email', async () => {
    const { container } = render();

    await screen.findByText('Ada L.');
    expect(container.textContent).not.toMatch(/userId|@/);
  });

  it('refetches the summary and list after the student posts a review', async () => {
    let posted = false;
    const { user, calls } = render(
      {
        'course.myEnrolment': () => ({
          courseId: 'course-1',
          userId: 'student-1',
          status: 'active',
          progressPercent: 0,
        }),
        'review.mine': () => (posted ? mine : null),
        'review.post': () => {
          posted = true;
          return mine;
        },
      },
      { signedIn: true },
    );
    const mine = {
      rating: 5,
      createdAt: '2026-10-05T12:00:00.000Z',
      version: 1,
      status: 'visible',
    };

    await user.click(await screen.findByRole('radio', { name: '5 stars' }));
    await user.click(screen.getByRole('button', { name: 'Post review' }));

    await waitFor(() => {
      for (const path of ['review.summary', 'review.list']) {
        expect(calls.filter((call) => call.path === path)).toHaveLength(2);
      }
    });
  });
});
