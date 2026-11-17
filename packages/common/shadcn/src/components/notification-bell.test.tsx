/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  NotificationBell,
  type NotificationBellItem,
  type NotificationBellProps,
} from './notification-bell';

const item = (
  position: string,
  overrides: Partial<NotificationBellItem> = {},
): NotificationBellItem => ({
  position,
  type: 'assignment.graded',
  title: `Title ${position}`,
  body: `Body ${position}`,
  link: { portal: 'student', path: '/my-learning' },
  occurredAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  read: false,
  ...overrides,
});

const renderBell = (props: Partial<NotificationBellProps> = {}) => {
  const handlers = {
    onOpenChange: vi.fn(),
    onSelect: vi.fn(),
    onMarkAllRead: vi.fn(),
    onLoadMore: vi.fn(),
    onRetry: vi.fn(),
  };
  render(
    <NotificationBell
      unreadCount={0}
      items={[]}
      isLoading={false}
      isError={false}
      hasMore={false}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
};

const open = () => userEvent.click(screen.getByRole('button'));

describe('NotificationBell', () => {
  it('shows no badge when nothing is unread', () => {
    renderBell({ unreadCount: 0 });

    const bell = screen.getByRole('button', { name: 'Notifications' });
    expect(bell).toHaveTextContent('');
  });

  it('shows the unread count in a badge and in the accessible name', () => {
    renderBell({ unreadCount: 7 });

    const bell = screen.getByRole('button', {
      name: 'Notifications, 7 unread',
    });
    expect(bell).toHaveTextContent('7');
  });

  it('caps the badge at 99+', () => {
    renderBell({ unreadCount: 100 });

    expect(
      screen.getByRole('button', { name: 'Notifications, 100 unread' }),
    ).toHaveTextContent('99+');
  });

  it('shows 99 as is', () => {
    renderBell({ unreadCount: 99 });

    expect(screen.getByRole('button')).toHaveTextContent('99');
    expect(screen.getByRole('button')).not.toHaveTextContent('99+');
  });

  it('tells the portal when it opens', async () => {
    const { onOpenChange } = renderBell();

    await open();

    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('shows skeleton rows while loading', async () => {
    renderBell({ isLoading: true });
    await open();

    expect(await screen.findByTestId('notification-skeleton')).toBeVisible();
    expect(screen.queryByText("You're all caught up.")).toBeNull();
  });

  it('says so when there is nothing to show', async () => {
    renderBell();
    await open();

    expect(await screen.findByText("You're all caught up.")).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('lists items with unread rows marked beyond colour', async () => {
    renderBell({
      unreadCount: 1,
      items: [item('b'), item('a', { read: true })],
    });
    await open();

    const unread = await screen.findByRole('button', { name: /Title b/ });
    expect(unread).toHaveTextContent('Unread:');
    expect(unread).toHaveTextContent('Body b');
    expect(unread).toHaveTextContent('2 hours ago');
    expect(unread.querySelector('time')).toHaveAttribute('title');
    expect(
      screen.getByRole('button', { name: /Title a/ }),
    ).not.toHaveTextContent('Unread:');
  });

  it('selects an item', async () => {
    const { onSelect } = renderBell({ unreadCount: 1, items: [item('b')] });
    await open();

    await userEvent.click(
      await screen.findByRole('button', { name: /Title b/ }),
    );

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ position: 'b' }),
    );
  });

  it('marks all as read, disabled when none are unread', async () => {
    const { onMarkAllRead } = renderBell({
      unreadCount: 2,
      items: [item('b'), item('a')],
    });
    await open();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Mark all as read' }),
    );
    expect(onMarkAllRead).toHaveBeenCalledOnce();
  });

  it('disables Mark all as read with none unread', async () => {
    renderBell({ unreadCount: 0, items: [item('a', { read: true })] });
    await open();

    expect(
      await screen.findByRole('button', { name: 'Mark all as read' }),
    ).toBeDisabled();
  });

  it('offers Load more only when there is more', async () => {
    const { onLoadMore } = renderBell({ items: [item('a')], hasMore: true });
    await open();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Load more' }),
    );
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('shows an error with Try again', async () => {
    const { onRetry } = renderBell({ isError: true });
    await open();

    expect(await screen.findByRole('alert')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
