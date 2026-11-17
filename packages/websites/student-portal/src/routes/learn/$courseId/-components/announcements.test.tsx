/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  renderWithCoreApi,
} from '../../../../test/render-with-core-api';
import { Announcements } from './announcements';

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const item = (id: string, over: Record<string, unknown> = {}) => ({
  announcementId: id,
  courseId: 'course-1',
  title: `Title ${id}`,
  body: doc(`Body ${id}`),
  authorName: 'Alice Smith',
  createdAt: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString(),
  ...over,
});

const render = (list: (input: any) => unknown) =>
  renderWithCoreApi(<Announcements courseId="course-1" />, {
    handlers: { 'announcement.list': list },
  });

describe('Announcements', () => {
  it('shows skeleton rows while loading', async () => {
    render(() => new Promise(() => {}));

    expect(
      await screen.findByRole('heading', { name: 'Announcements' }),
    ).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('says so when nothing has been posted', async () => {
    render(() => ({ items: [] }));

    expect(
      await screen.findByText("Your instructor hasn't posted anything yet."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Load more' }),
    ).not.toBeInTheDocument();
  });

  it('shows each item with its author, time and body', async () => {
    const { calls } = render(() => ({ items: [item('a'), item('b')] }));

    expect(await screen.findByText('Title a')).toBeInTheDocument();
    expect(screen.getByText('Body a')).toBeInTheDocument();
    expect(screen.getByText('Title b')).toBeInTheDocument();
    const row = screen.getByText('Title a').closest('li') as HTMLElement;
    expect(row).toHaveTextContent('Alice Smith posted 3 days ago');
    expect(within(row).getByText('3 days ago')).toHaveAttribute('title');
    expect(row).not.toHaveTextContent('edited');
    expect(calls[0]?.input).toMatchObject({ courseId: 'course-1' });
  });

  it('shows "edited" with the time when the announcement was edited', async () => {
    render(() => ({
      items: [
        item('a', {
          editedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        }),
      ],
    }));

    expect(await screen.findByText('edited 1 hour ago')).toBeInTheDocument();
  });

  it('shows a title containing markup as text', async () => {
    render(() => ({ items: [item('a', { title: '<b>x</b>' })] }));

    expect(await screen.findByText('<b>x</b>')).toBeInTheDocument();
    expect(document.querySelector('h3 b')).toBeNull();
  });

  it('loads the next page on "Load more" and hides it at the end', async () => {
    const { user, calls } = render((input) =>
      input.cursor === 'p2'
        ? { items: [item('b')] }
        : { items: [item('a')], cursor: 'p2' },
    );

    await user.click(await screen.findByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Title b')).toBeInTheDocument();
    expect(screen.getByText('Title a')).toBeInTheDocument();
    expect(calls.at(-1)?.input).toMatchObject({ cursor: 'p2' });
    expect(
      screen.queryByRole('button', { name: 'Load more' }),
    ).not.toBeInTheDocument();
  });

  it('shows the error and retries on "Try again"', async () => {
    let fail = true;
    const { user } = render(() => {
      if (fail) {
        throw new ApiError('FORBIDDEN', 'Enrol in the course to view it');
      }
      return { items: [item('a')] };
    });

    expect(
      await screen.findByText('Enrol in the course to view it'),
    ).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Title a')).toBeInTheDocument();
  });

  it('shows a body that cannot be read as a notice in that row only', async () => {
    render(() => ({
      items: [item('a', { body: 'not a document' }), item('b')],
    }));

    expect(
      await screen.findByText('This announcement could not be displayed.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Body b')).toBeInTheDocument();
  });
});
