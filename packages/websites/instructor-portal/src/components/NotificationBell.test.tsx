/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ApiCall,
  ApiError,
  type Handler,
  renderWithCoreApi,
} from '../test/render-with-core-api';
import { NotificationBell } from './NotificationBell';

// There's no router in these renders; the portal's navigation is a spy.
const navigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ navigate }),
}));

afterEach(() => {
  navigate.mockReset();
  vi.unstubAllGlobals();
});

const portals = {
  StudentPortal: 'https://learn.example',
  InstructorPortal: 'https://teach.example',
  AdminPortal: 'https://admin.example',
};

const item = (position: string, overrides: Record<string, unknown> = {}) => ({
  position,
  type: 'assignment.graded',
  title: `Title ${position}`,
  body: `Body ${position}`,
  link: { portal: 'instructor', path: '/here/instructor' },
  occurredAt: new Date().toISOString(),
  read: false,
  ...overrides,
});

const handlers = (overrides: Record<string, Handler> = {}) => ({
  'notification.unreadCount': () => ({ unreadCount: 3 }),
  'notification.list': () => ({
    items: [item('c'), item('b', { read: true })],
    unreadCount: 3,
  }),
  'notification.markRead': () => ({ unreadCount: 2 }),
  'notification.markAllRead': () => ({ unreadCount: 0, more: false }),
  ...overrides,
});

const callsTo = (calls: ApiCall[], path: string) =>
  calls.filter((call) => call.path === path);

describe('NotificationBell (instructor portal)', () => {
  it('shows the unread count from the API', async () => {
    renderWithCoreApi(<NotificationBell />, {
      handlers: handlers(),
      runtimeConfig: { portals },
    });

    expect(
      await screen.findByRole('button', { name: 'Notifications, 3 unread' }),
    ).toHaveTextContent('3');
  });

  it('lists the notifications when opened, and not before', async () => {
    const { calls, user } = renderWithCoreApi(<NotificationBell />, {
      handlers: handlers(),
      runtimeConfig: { portals },
    });
    await screen.findByRole('button', { name: 'Notifications, 3 unread' });
    expect(callsTo(calls, 'notification.list')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /Notifications/ }));

    expect(await screen.findByText('Title c')).toBeInTheDocument();
    expect(callsTo(calls, 'notification.list')).toHaveLength(1);
  });

  it('marks an unread item read, then follows its link', async () => {
    const { calls, user } = renderWithCoreApi(<NotificationBell />, {
      handlers: handlers(),
      runtimeConfig: { portals },
    });
    await user.click(
      await screen.findByRole('button', { name: /Notifications/ }),
    );

    await user.click(await screen.findByRole('button', { name: /Title c/ }));

    await waitFor(() =>
      expect(callsTo(calls, 'notification.markRead')).toHaveLength(1),
    );
    expect(callsTo(calls, 'notification.markRead')[0].input).toEqual({
      position: 'c',
    });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/here/instructor' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Notifications, 2 unread' }),
    ).toBeInTheDocument();
  });

  it("doesn't mark an already read item read", async () => {
    const { calls, user } = renderWithCoreApi(<NotificationBell />, {
      handlers: handlers(),
      runtimeConfig: { portals },
    });
    await user.click(
      await screen.findByRole('button', { name: /Notifications/ }),
    );

    await user.click(await screen.findByRole('button', { name: /Title b/ }));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(callsTo(calls, 'notification.markRead')).toHaveLength(0);
  });

  it("opens another portal's address for a cross-portal link", async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const { user } = renderWithCoreApi(<NotificationBell />, {
      handlers: handlers({
        'notification.list': () => ({
          items: [
            item('c', { link: { portal: 'student', path: '/over/there' } }),
          ],
          unreadCount: 1,
        }),
      }),
      runtimeConfig: { portals },
    });
    await user.click(
      await screen.findByRole('button', { name: /Notifications/ }),
    );

    await user.click(await screen.findByRole('button', { name: /Title c/ }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://learn.example/over/there'),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('marks all as read with the newest shown position', async () => {
    const { calls, user } = renderWithCoreApi(<NotificationBell />, {
      handlers: handlers(),
      runtimeConfig: { portals },
    });
    await user.click(
      await screen.findByRole('button', { name: /Notifications/ }),
    );
    await screen.findByText('Title c');

    await user.click(screen.getByRole('button', { name: 'Mark all as read' }));

    await waitFor(() =>
      expect(callsTo(calls, 'notification.markAllRead')).toHaveLength(1),
    );
    expect(callsTo(calls, 'notification.markAllRead')[0].input).toEqual({
      through: 'c',
    });
    expect(
      await screen.findByRole('button', { name: 'Notifications' }),
    ).toBeInTheDocument();
  });

  it('repeats mark all while the API says there is more', async () => {
    let call = 0;
    const { calls, user } = renderWithCoreApi(<NotificationBell />, {
      handlers: handlers({
        'notification.markAllRead': () => {
          call += 1;
          return { unreadCount: call === 1 ? 5 : 0, more: call === 1 };
        },
      }),
      runtimeConfig: { portals },
    });
    await user.click(
      await screen.findByRole('button', { name: /Notifications/ }),
    );
    await screen.findByText('Title c');

    await user.click(screen.getByRole('button', { name: 'Mark all as read' }));

    await waitFor(() =>
      expect(callsTo(calls, 'notification.markAllRead')).toHaveLength(2),
    );
  });

  it('shows the error state when the list fails', async () => {
    const { user } = renderWithCoreApi(<NotificationBell />, {
      handlers: handlers({
        'notification.list': () => {
          throw new ApiError('INTERNAL_SERVER_ERROR', 'boom');
        },
      }),
      runtimeConfig: { portals },
    });
    await user.click(
      await screen.findByRole('button', { name: /Notifications/ }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't load your notifications.",
    );
    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument();
  });
});
