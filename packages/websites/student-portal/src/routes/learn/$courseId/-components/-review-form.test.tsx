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
import { ReviewForm } from './review-form';

const enrolment = (status = 'active') => ({
  courseId: 'course-1',
  userId: 'student-1',
  status,
  progressPercent: 0,
});

const own = (overrides: Record<string, unknown> = {}) => ({
  rating: 4,
  text: 'Good course.',
  createdAt: '2026-10-05T12:00:00.000Z',
  version: 3,
  status: 'visible',
  ...overrides,
});

const render = (
  handlers: Record<string, Handler> = {},
  { signedIn = true } = {},
) =>
  renderWithCoreApi(<ReviewForm courseId="course-1" />, {
    signedIn,
    handlers: {
      'course.myEnrolment': () => enrolment(),
      'review.mine': () => null,
      'review.summary': () => ({
        count: 0,
        stars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      }),
      'review.list': () => ({ items: [], cursor: null }),
      ...handlers,
    },
  });

const callsTo = (calls: { path: string; input: unknown }[], path: string) =>
  calls.filter((call) => call.path === path).map((call) => call.input);

describe('ReviewForm', () => {
  it('asks a signed-out visitor to sign in and enrol, without calling the API', async () => {
    const { calls } = render({}, { signedIn: false });

    expect(
      await screen.findByText('Sign in and enrol to review'),
    ).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('asks a student who is not enrolled to enrol', async () => {
    const { calls } = render({ 'course.myEnrolment': () => null });

    expect(
      await screen.findByText('Enrol in this course to review it'),
    ).toBeInTheDocument();
    expect(callsTo(calls, 'review.mine')).toEqual([]);
  });

  it('offers no form to a student whose enrolment was dropped and who has no review', async () => {
    const { calls } = render({
      'course.myEnrolment': () => enrolment('dropped'),
    });

    await waitFor(() => expect(callsTo(calls, 'review.mine')).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'Post review' })).toBeNull();
  });

  it('lets a student who dropped the course edit and delete the review they wrote', async () => {
    const { user, calls } = render({
      'course.myEnrolment': () => enrolment('dropped'),
      'review.mine': () => own(),
      'review.edit': () => own({ rating: 5, version: 4 }),
    });

    expect(await screen.findByText('Good course.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Delete review' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('radio', { name: '5 stars' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(callsTo(calls, 'review.edit')).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'Post review' })).toBeNull();
  });

  it('shows the form with five labelled radios and a counter', async () => {
    render();

    expect(
      await screen.findByRole('button', { name: 'Post review' }),
    ).toBeDisabled();
    expect(screen.getByRole('radio', { name: '1 star' })).toBeInTheDocument();
    for (const n of [2, 3, 4, 5]) {
      expect(
        screen.getByRole('radio', { name: `${n} stars` }),
      ).toBeInTheDocument();
    }
    expect(screen.getByText('0 / 2,000')).toBeInTheDocument();
  });

  it('posts the rating and trimmed text', async () => {
    const { user, calls } = render({ 'review.post': () => own() });

    await user.click(await screen.findByRole('radio', { name: '4 stars' }));
    await user.type(screen.getByLabelText(/Your review/), '  Good course.  ');
    expect(screen.getByText('16 / 2,000')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Post review' }));

    expect(await screen.findByText('Good course.')).toBeInTheDocument();
    expect(callsTo(calls, 'review.post')).toEqual([
      { courseId: 'course-1', rating: 4, text: 'Good course.' },
    ]);
  });

  it('sends one request when Post is double-clicked', async () => {
    const { user, calls } = render({
      'review.post': async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return own();
      },
    });

    await user.click(await screen.findByRole('radio', { name: '5 stars' }));
    await user.dblClick(screen.getByRole('button', { name: 'Post review' }));

    await screen.findByText('Your review');
    expect(callsTo(calls, 'review.post')).toHaveLength(1);
  });

  it('shows a failing post and keeps the form', async () => {
    const { user } = render({
      'review.post': () => {
        throw new ApiError('FORBIDDEN', 'You must be enrolled to review');
      },
    });

    await user.click(await screen.findByRole('radio', { name: '2 stars' }));
    await user.type(screen.getByLabelText(/Your review/), 'Hmm');
    await user.click(screen.getByRole('button', { name: 'Post review' }));

    expect(
      await screen.findByText('You must be enrolled to review'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Your review/)).toHaveValue('Hmm');
    expect(screen.getByRole('radio', { name: '2 stars' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Post review' })).toBeEnabled();
  });

  it('shows the student their own review with Edit and Delete review', async () => {
    render({ 'review.mine': () => own() });

    expect(await screen.findByText('Good course.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Delete review' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post review' })).toBeNull();
  });

  it('edits with the version it read, and Cancel leaves the review alone', async () => {
    const { user, calls } = render({
      'review.mine': () => own(),
      'review.edit': () => own({ rating: 5, text: 'Great!', version: 4 }),
    });

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Good course.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('radio', { name: '4 stars' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: '5 stars' }));
    const text = screen.getByLabelText(/Your review/);
    await user.clear(text);
    await user.type(text, 'Great!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Great!')).toBeInTheDocument();
    expect(callsTo(calls, 'review.edit')).toEqual([
      { courseId: 'course-1', rating: 5, text: 'Great!', version: 3 },
    ]);
  });

  it('deletes with the version it read, after confirming', async () => {
    const { user, calls } = render({
      'review.mine': () => own(),
      'review.delete': () => ({ deleted: true }),
    });

    await user.click(
      await screen.findByRole('button', { name: 'Delete review' }),
    );
    expect(callsTo(calls, 'review.delete')).toEqual([]);
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete review' }),
    );

    expect(
      await screen.findByRole('button', { name: 'Post review' }),
    ).toBeInTheDocument();
    expect(callsTo(calls, 'review.delete')).toEqual([
      { courseId: 'course-1', version: 3 },
    ]);
  });

  it('shows a removed review as a notice with the reason and no form', async () => {
    render({
      'review.mine': () =>
        own({ status: 'removed', removedReason: 'Contains spam' }),
    });

    expect(
      await screen.findByText('Your review was removed by a moderator'),
    ).toBeInTheDocument();
    expect(screen.getByText('Reason: Contains spam')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post review' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('offers a reload when a save conflicts', async () => {
    let reads = 0;
    const { user, calls } = render({
      'review.mine': () => {
        reads += 1;
        return reads === 1 ? own() : own({ version: 4, text: 'Changed.' });
      },
      'review.edit': () => {
        throw new ApiError('CONFLICT', 'stale');
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText('Your review changed; reload it'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload' }));

    expect(await screen.findByText('Changed.')).toBeInTheDocument();
    expect(callsTo(calls, 'review.mine')).toHaveLength(2);
  });

  it('closes the delete dialog and shows a CONFLICT with a reload prompt', async () => {
    const { user } = render({
      'review.mine': () => own(),
      'review.delete': () => {
        throw new ApiError('CONFLICT', 'stale');
      },
    });

    await user.click(
      await screen.findByRole('button', { name: 'Delete review' }),
    );
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Delete review',
      }),
    );

    expect(
      await screen.findByText('Your review changed; reload it'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeVisible();
  });

  it('closes the delete dialog and shows any other delete error', async () => {
    const { user } = render({
      'review.mine': () => own(),
      'review.delete': () => {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'Delete is down');
      },
    });

    await user.click(
      await screen.findByRole('button', { name: 'Delete review' }),
    );
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Delete review',
      }),
    );

    expect(
      await screen.findByText(
        'Something went wrong on our side. Try again in a moment.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('Good course.')).toBeInTheDocument();
  });
});
