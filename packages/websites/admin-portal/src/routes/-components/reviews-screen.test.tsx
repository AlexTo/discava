/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  type Handler,
  renderWithAdminApi,
} from '../../test/render-with-admin-api';
import { ReviewsScreen } from './reviews-screen';

const courses = {
  items: [
    { courseId: 'c1', title: 'Physics', status: 'published', ratingCount: 2 },
    { courseId: 'c2', title: 'Old Maths', status: 'archived', ratingCount: 0 },
  ],
};
const visible = {
  reviewerId: 's1',
  reviewerName: 'Sam L.',
  rating: 4,
  text: 'Clear and well paced.',
  createdAt: '2026-11-17T10:00:00.000Z',
  status: 'visible',
};
const removed = {
  reviewerId: 's2',
  reviewerName: 'Bo K.',
  rating: 1,
  text: 'Rude words here.',
  createdAt: '2026-11-16T10:00:00.000Z',
  status: 'removed',
  removedAt: '2026-11-18T10:00:00.000Z',
  removedBy: 'admin-1',
  removedReason: 'Abusive language',
};

const render = (handlers: Record<string, Handler> = {}) =>
  renderWithAdminApi(<ReviewsScreen />, {
    handlers: {
      'review.courses': () => courses,
      'review.list': () => ({ items: [visible, removed] }),
      ...handlers,
    },
  });

const pick = async (rendered: ReturnType<typeof render>, name = /Physics/) => {
  const select = await screen.findByLabelText('Course');
  await rendered.user.selectOptions(
    select,
    within(select).getByRole('option', { name }),
  );
};

describe('the Reviews screen', () => {
  it('offers published and archived courses with their rating counts', async () => {
    render();

    expect(
      await screen.findByRole('option', { name: 'Physics · 2 ratings' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Old Maths (archived) · 0 ratings' }),
    ).toBeInTheDocument();
  });

  it('lists the course reviews, marking removed ones with their reason', async () => {
    const rendered = render();
    await pick(rendered);

    expect(
      await screen.findByText('Clear and well paced.'),
    ).toBeInTheDocument();
    expect(rendered.calls).toContainEqual({
      path: 'review.list',
      input: expect.objectContaining({ courseId: 'c1' }),
    });
    const gone = screen.getByText('Bo K.').closest('li')!;
    expect(within(gone).getByText('Removed')).toBeInTheDocument();
    expect(within(gone).getByText('Abusive language')).toBeInTheDocument();
    expect(
      within(gone).queryByRole('button', { name: /Remove/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: "Remove Sam L.'s review" }),
    ).toBeInTheDocument();
  });

  it('keeps Remove disabled until a reason is entered, then removes with it', async () => {
    const rendered = render({ 'review.remove': () => ({ ...visible }) });
    await pick(rendered);
    await rendered.user.click(
      await screen.findByRole('button', { name: "Remove Sam L.'s review" }),
    );

    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', {
      name: 'Remove review',
    });
    expect(submit).toBeDisabled();

    await rendered.user.type(
      within(dialog).getByLabelText('Reason'),
      '  Abusive language ',
    );
    expect(submit).toBeEnabled();
    await rendered.user.click(submit);

    await waitFor(() =>
      expect(rendered.calls).toContainEqual({
        path: 'review.remove',
        input: {
          courseId: 'c1',
          reviewerId: 's1',
          reason: 'Abusive language',
        },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        rendered.calls.filter((c) => c.path === 'review.list').length,
      ).toBeGreaterThan(1),
    );
  });

  it('shows a failed removal in the dialog and keeps the reason', async () => {
    const rendered = render({
      'review.remove': () => {
        throw new ApiError('CONFLICT', 'Please retry');
      },
    });
    await pick(rendered);
    await rendered.user.click(
      await screen.findByRole('button', { name: "Remove Sam L.'s review" }),
    );
    const dialog = await screen.findByRole('dialog');
    await rendered.user.type(within(dialog).getByLabelText('Reason'), 'Spam');
    await rendered.user.click(
      within(dialog).getByRole('button', { name: 'Remove review' }),
    );

    expect(await within(dialog).findByText('Please retry')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Reason')).toHaveValue('Spam');
  });

  it('says so when the course has no reviews', async () => {
    const rendered = render({ 'review.list': () => ({ items: [] }) });
    await pick(rendered);

    expect(await screen.findByText('No reviews yet.')).toBeInTheDocument();
  });

  it('shows an error with a retry when the reviews fail to load', async () => {
    let fail = true;
    const rendered = render({
      'review.list': () => {
        if (fail) {
          throw new ApiError('INTERNAL_SERVER_ERROR', 'Boom');
        }
        return { items: [visible] };
      },
    });
    await pick(rendered);

    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
    fail = false;
    await rendered.user.click(
      screen.getByRole('button', { name: 'Try again' }),
    );

    expect(
      await screen.findByText('Clear and well paced.'),
    ).toBeInTheDocument();
  });

  it('shows an error with a retry when the courses fail to load', async () => {
    let fail = true;
    const rendered = render({
      'review.courses': () => {
        if (fail) {
          throw new ApiError('INTERNAL_SERVER_ERROR', 'No courses for you');
        }
        return courses;
      },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No courses for you',
    );
    fail = false;
    await rendered.user.click(
      screen.getByRole('button', { name: 'Try again' }),
    );

    expect(await screen.findByLabelText('Course')).toBeInTheDocument();
  });

  it('says so when there are no courses to review', async () => {
    render({ 'review.courses': () => ({ items: [] }) });

    expect(
      await screen.findByText('No published or archived courses yet.'),
    ).toBeInTheDocument();
  });
});
