/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { fakeTrpcFetch, type Handler } from '@discava/common-web-utils/testing';
import type { AppRouter as CoreRouter } from '@discava/core-api';
import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { describe, expect, it } from 'vitest';
import { CoreApiTRPCContext } from '../../../../../api';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../test/render-with-instructor-api';
import { ReviewsScreen } from './reviews-screen';

const review = (n: number, extra = {}) => ({
  reviewerId: `student-${n}`,
  reviewerName: `Student ${n}`,
  rating: 4,
  text: `Review text ${n}`,
  createdAt: '2026-11-17T10:00:00.000Z',
  ...extra,
});
const response = {
  text: 'Thank you!',
  byName: 'Alice S.',
  at: '2026-11-18T10:00:00.000Z',
};

const summary = {
  count: 3,
  average: 4.3,
  stars: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 },
};

// The summary is core-api's, so the screen needs both APIs.
const render = ({
  instructor,
  core = { 'review.summary': () => summary },
}: {
  instructor: Record<string, Handler>;
  core?: Record<string, Handler>;
}) => {
  const coreCalls: { path: string; input: unknown }[] = [];
  const client = createTRPCClient<CoreRouter>({
    links: [
      httpLink({
        url: 'http://core-api.test/',
        fetch: fakeTrpcFetch(core, coreCalls),
      }),
    ],
  });
  const optionsProxy = createTRPCOptionsProxy<CoreRouter>({
    client,
    queryClient: new QueryClient(),
  });
  return renderWithInstructorApi(
    <CoreApiTRPCContext.Provider value={{ client, optionsProxy }}>
      <ReviewsScreen courseId="course-1" />
    </CoreApiTRPCContext.Provider>,
    { handlers: instructor },
  );
};

describe('ReviewsScreen', () => {
  it('shows the average, the breakdown and the reviews', async () => {
    render({
      instructor: {
        'review.list': () => ({
          items: [review(1), review(2, { response, editedAt: 'x' })],
        }),
      },
    });

    expect(await screen.findByText('Review text 1')).toBeInTheDocument();
    expect(await screen.findByText('4.3')).toBeInTheDocument();
    expect(screen.getByText('3 ratings')).toBeInTheDocument();
    expect(
      within(
        screen.getByRole('list', { name: 'Ratings breakdown' }),
      ).getAllByRole('listitem'),
    ).toHaveLength(5);
    expect(screen.getByText('Student 2')).toBeInTheDocument();
    expect(screen.getByText('Thank you!')).toBeInTheDocument();
    expect(screen.getByText(/Response from Alice S\./)).toBeInTheDocument();
  });

  it('offers Respond on an unanswered review and Edit and Delete on an answered one', async () => {
    render({
      instructor: {
        'review.list': () => ({ items: [review(1), review(2, { response })] }),
      },
    });

    expect(
      await screen.findByRole('button', {
        name: "Respond to Student 1's review",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: "Edit response to Student 2's review",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: "Delete response to Student 2's review",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: "Delete response to Student 1's review",
      }),
    ).not.toBeInTheDocument();
  });

  it('wraps long names, reviews and responses', async () => {
    render({
      instructor: {
        'review.list': () => ({
          items: [
            review(1, {
              reviewerName: 'N'.repeat(70),
              text: 'T'.repeat(500),
              response: { ...response, text: 'R'.repeat(500) },
            }),
          ],
        }),
      },
    });

    expect(await screen.findByText('N'.repeat(70))).toHaveClass('break-words');
    expect(screen.getByText('T'.repeat(500))).toHaveClass('break-words');
    expect(screen.getByText('R'.repeat(500))).toHaveClass('break-words');
  });

  it('shows the empty states', async () => {
    render({
      instructor: { 'review.list': () => ({ items: [] }) },
      core: { 'review.summary': () => ({ count: 0, stars: summary.stars }) },
    });

    expect(await screen.findByText('No reviews yet.')).toBeInTheDocument();
    expect(await screen.findByText('No ratings yet.')).toBeInTheDocument();
  });

  it('loads more reviews', async () => {
    const { calls, user } = render({
      instructor: {
        'review.list': (input) =>
          (input as { cursor?: string }).cursor
            ? { items: [review(2)] }
            : { items: [review(1)], cursor: 'c1' },
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Review text 2')).toBeInTheDocument();
    expect(calls.filter((c) => c.path === 'review.list')).toHaveLength(2);
  });

  it('shows an error with a retry', async () => {
    let fail = true;
    const { user } = render({
      instructor: {
        'review.list': () => {
          if (fail) {
            throw new ApiError('INTERNAL_SERVER_ERROR', 'Boom');
          }
          return { items: [review(1)] };
        },
      },
    });

    expect(
      await screen.findByText(
        'Something went wrong on our side. Try again in a moment.',
      ),
    ).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Review text 1')).toBeInTheDocument();
  });

  it('responds with the trimmed text and refreshes the list', async () => {
    const { calls, user } = render({
      instructor: {
        'review.list': () => ({ items: [review(1)] }),
        'review.respond': () => review(1, { response }),
      },
    });

    await user.click(
      await screen.findByRole('button', {
        name: "Respond to Student 1's review",
      }),
    );
    const save = screen.getByRole('button', { name: 'Save response' });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText('Response'), '  Thanks!  ');
    expect(screen.getByText('11/1000')).toBeInTheDocument();
    await user.click(save);

    await waitFor(() =>
      expect(calls.filter((c) => c.path === 'review.respond')).toEqual([
        {
          path: 'review.respond',
          input: {
            courseId: 'course-1',
            reviewerId: 'student-1',
            text: 'Thanks!',
          },
        },
      ]),
    );
    await waitFor(() =>
      expect(calls.filter((c) => c.path === 'review.list')).toHaveLength(2),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('starts an edit from the current response', async () => {
    const { user } = render({
      instructor: {
        'review.list': () => ({ items: [review(2, { response })] }),
      },
    });

    await user.click(
      await screen.findByRole('button', {
        name: "Edit response to Student 2's review",
      }),
    );

    expect(screen.getByLabelText('Response')).toHaveValue('Thank you!');
  });

  it('shows a failed response and keeps the dialog and the text', async () => {
    const { user } = render({
      instructor: {
        'review.list': () => ({ items: [review(1)] }),
        'review.respond': () => {
          throw new ApiError('PRECONDITION_FAILED', 'This review was removed');
        },
      },
    });

    await user.click(
      await screen.findByRole('button', {
        name: "Respond to Student 1's review",
      }),
    );
    await user.type(screen.getByLabelText('Response'), 'Thanks');
    await user.click(screen.getByRole('button', { name: 'Save response' }));

    expect(
      await screen.findByText('This review was removed'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Response')).toHaveValue('Thanks');
  });

  it('deletes a response after confirming', async () => {
    const { calls, user } = render({
      instructor: {
        'review.list': () => ({ items: [review(2, { response })] }),
        'review.deleteResponse': () => review(2),
      },
    });

    await user.click(
      await screen.findByRole('button', {
        name: "Delete response to Student 2's review",
      }),
    );
    expect(calls.some((c) => c.path === 'review.deleteResponse')).toBe(false);
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete response',
      }),
    );

    await waitFor(() =>
      expect(calls.filter((c) => c.path === 'review.deleteResponse')).toEqual([
        {
          path: 'review.deleteResponse',
          input: { courseId: 'course-1', reviewerId: 'student-2' },
        },
      ]),
    );
  });

  it('shows a failed delete and keeps the dialog', async () => {
    const { user } = render({
      instructor: {
        'review.list': () => ({ items: [review(2, { response })] }),
        'review.deleteResponse': () => {
          throw new ApiError('FORBIDDEN', 'Not allowed');
        },
      },
    });

    await user.click(
      await screen.findByRole('button', {
        name: "Delete response to Student 2's review",
      }),
    );
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete response',
      }),
    );

    expect(await screen.findByText('Not allowed')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
