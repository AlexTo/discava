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

  it('wraps long review text, responses and removal reasons', async () => {
    const word = 'y'.repeat(70);
    const rendered = render({
      'review.list': () => ({
        items: [
          {
            ...visible,
            reviewerName: word,
            text: `${'t'.repeat(400)} ${word}`,
            response: {
              byName: 'Ann',
              at: '2026-11-18T10:00:00.000Z',
              text: `Thanks ${word}`,
            },
          },
          { ...removed, removedReason: word },
        ],
      }),
    });
    await pick(rendered);

    const first = (await screen.findAllByRole('listitem'))[0];
    const text = within(first).getByText(/^t{400}/);
    expect(text).toHaveClass('break-words', '[overflow-wrap:anywhere]');
    expect(within(first).getByText(`Thanks ${word}`)).toHaveClass(
      'break-words',
      '[overflow-wrap:anywhere]',
    );
    expect(within(first).getByText(/^Response from Ann/)).toHaveClass(
      'min-w-0',
      'break-words',
    );
    const name = within(first).getByText(/^y{70}\s*$/);
    expect(name).toHaveClass('min-w-0', 'break-words');
    expect(name.parentElement?.parentElement).toHaveClass('flex-wrap');
    expect(screen.getAllByText(word, { selector: 'span' })[0]).toHaveClass(
      'break-words',
      '[overflow-wrap:anywhere]',
    );
    expect(
      within(first).getByRole('button', { name: /^Remove/ }),
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

  it('asks before Escape discards a typed reason, and Keep editing keeps it', async () => {
    const rendered = render();
    await pick(rendered);
    await rendered.user.click(
      await screen.findByRole('button', { name: "Remove Sam L.'s review" }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Remove review' });
    await rendered.user.type(within(dialog).getByLabelText('Reason'), 'Spam');

    await rendered.user.keyboard('{Escape}');
    expect(await screen.findByText('Discard unsaved changes?')).toBeVisible();

    await rendered.user.click(
      screen.getByRole('button', { name: 'Keep editing' }),
    );
    await waitFor(() =>
      expect(screen.queryByText('Discard unsaved changes?')).toBeNull(),
    );
    expect(screen.getByLabelText('Reason')).toHaveValue('Spam');
  });

  it('closes on Escape with nothing typed, and Cancel then reopen shows an empty reason', async () => {
    const rendered = render();
    await pick(rendered);
    const remove = await screen.findByRole('button', {
      name: "Remove Sam L.'s review",
    });
    await rendered.user.click(remove);
    await screen.findByRole('dialog');
    await rendered.user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await rendered.user.click(remove);
    await rendered.user.type(await screen.findByLabelText('Reason'), 'Spam');
    await rendered.user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('Discard unsaved changes?')).toBeNull();

    await rendered.user.click(remove);
    expect(await screen.findByLabelText('Reason')).toHaveValue('');
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

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on our side. Try again in a moment.',
    );
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
      'Something went wrong on our side. Try again in a moment.',
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

describe('the Reviews screen, with the keyboard', () => {
  it('returns focus to Remove when the dialog is cancelled', async () => {
    const rendered = render();
    await pick(rendered);
    const remove = await screen.findByRole('button', {
      name: "Remove Sam L.'s review",
    });
    await rendered.user.click(remove);
    await screen.findByRole('dialog');

    await rendered.user.keyboard('{Escape}');

    await waitFor(() => expect(remove).toHaveFocus());
  });

  it('focuses the removed review, announces it, and keeps the counter quiet', async () => {
    let gone = false;
    const rendered = render({
      'review.list': () => ({
        items: [
          gone
            ? { ...removed, reviewerId: 's1', reviewerName: 'Sam L.' }
            : visible,
        ],
      }),
      'review.remove': () => {
        gone = true;
        return visible;
      },
    });
    await pick(rendered);
    await rendered.user.click(
      await screen.findByRole('button', { name: "Remove Sam L.'s review" }),
    );
    const dialog = await screen.findByRole('dialog');
    const reason = within(dialog).getByLabelText('Reason');
    expect(reason).toHaveAccessibleDescription('0/200');
    expect(within(dialog).getByText('0/200')).not.toHaveAttribute('aria-live');
    await rendered.user.type(reason, 'Spam');
    await rendered.user.click(
      within(dialog).getByRole('button', { name: 'Remove review' }),
    );

    const item = await screen.findByRole('listitem', {
      name: 'Review by Sam L.',
    });
    await waitFor(() => expect(item).toHaveFocus());
    expect(item).toHaveAttribute('tabindex', '-1');
    await waitFor(() => expect(item).toHaveTextContent('Removed'));
    await waitFor(() =>
      expect(
        screen.getAllByRole('status').map((status) => status.textContent),
      ).toContain('Review removed.'),
    );
  });

  it('focuses the first review that Load more adds', async () => {
    const rendered = render({
      'review.list': (input) =>
        (input as { cursor?: string }).cursor
          ? { items: [{ ...visible, reviewerId: 's9', reviewerName: 'Zed' }] }
          : { items: [visible], cursor: 'next' },
    });
    await pick(rendered);

    await rendered.user.click(
      await screen.findByRole('button', { name: 'Load more' }),
    );

    const added = await screen.findByRole('listitem', {
      name: 'Review by Zed',
    });
    await waitFor(() => expect(added).toHaveFocus());
  });

  it('focuses the list when Load more adds nothing', async () => {
    const rendered = render({
      'review.list': (input) =>
        (input as { cursor?: string }).cursor
          ? { items: [] }
          : { items: [visible], cursor: 'next' },
    });
    await pick(rendered);

    await rendered.user.click(
      await screen.findByRole('button', { name: 'Load more' }),
    );

    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Reviews' })).toHaveFocus(),
    );
  });

  it('focuses the picker after More courses', async () => {
    const rendered = render({
      'review.courses': (input) =>
        (input as { cursor?: string }).cursor
          ? { items: [] }
          : { ...courses, cursor: 'next' },
    });
    await rendered.user.click(
      await screen.findByRole('button', { name: 'More courses' }),
    );

    await waitFor(() => expect(screen.getByLabelText('Course')).toHaveFocus());
  });

  it('keeps focus on a pending Remove review and sends nothing on a second press', async () => {
    const rendered = render({
      'review.remove': () => new Promise(() => {}),
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

    const pending = await within(dialog).findByRole('button', {
      name: 'Removing…',
    });
    expect(pending).toHaveAttribute('aria-disabled', 'true');
    pending.focus();
    await rendered.user.click(pending);
    expect(pending).toHaveFocus();
    expect(
      rendered.calls.filter((c) => c.path === 'review.remove'),
    ).toHaveLength(1);
  });
});

describe('the Reviews screen, as a page', () => {
  it('names the tab and says it is loading the courses', () => {
    render({ 'review.courses': () => new Promise(() => {}) });

    expect(document.title).toBe('Reviews · Discava');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Reviews' }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('status').map((status) => status.textContent),
    ).toContain('Loading the courses…');
  });

  it('says it is loading the reviews', async () => {
    const rendered = render({ 'review.list': () => new Promise(() => {}) });
    await pick(rendered);

    await waitFor(() =>
      expect(
        screen.getAllByRole('status').map((status) => status.textContent),
      ).toContain('Loading the reviews…'),
    );
  });
});
