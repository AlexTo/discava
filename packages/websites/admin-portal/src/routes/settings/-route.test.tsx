/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  type Handler,
  renderWithCoreApi,
} from '../../test/render-with-core-api';
import { Route } from './notifications';

const NotificationSettings = Route.options.component!;

const preferences = [
  {
    type: 'assignment.graded',
    name: 'Graded work',
    description: 'When your work has been graded',
    emailEnabled: true,
    required: false,
  },
  {
    type: 'account.security',
    name: 'Security alerts',
    description: 'Sign-in and password changes',
    emailEnabled: true,
    required: true,
  },
];

const open = (handlers: Record<string, Handler> = {}) =>
  renderWithCoreApi(<NotificationSettings />, {
    handlers: {
      'notification.preferences': () => preferences,
      ...handlers,
    },
  });

describe('notification settings', () => {
  it('lists the types from the API', async () => {
    open();

    expect(
      await screen.findByRole(
        'switch',
        { name: 'Graded work' },
        { timeout: 10_000 },
      ),
    ).toBeChecked();
    expect(
      screen.getByText('When your work has been graded'),
    ).toBeInTheDocument();
  });

  it('saves a toggled switch with its new value', async () => {
    const { calls, user } = open({
      'notification.setPreference': (input) => ({
        ...preferences[0],
        ...(input as object),
      }),
    });

    await user.click(
      await screen.findByRole('switch', { name: 'Graded work' }),
    );

    await waitFor(() =>
      expect(
        calls.find((call) => call.path === 'notification.setPreference')?.input,
      ).toEqual({ type: 'assignment.graded', emailEnabled: false }),
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Graded work' }),
    ).not.toBeChecked();
  });

  it('cannot toggle a required type', async () => {
    const { calls, user } = open();

    const required = await screen.findByRole('switch', {
      name: 'Security alerts',
    });
    expect(required).toBeDisabled();
    expect(screen.getByText('Always on')).toBeInTheDocument();
    await user.click(required);

    expect(
      calls.some((call) => call.path === 'notification.setPreference'),
    ).toBe(false);
  });

  it('reverts the switch and shows an error when saving fails', async () => {
    const { user } = open({
      'notification.setPreference': () => {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'Something went wrong');
      },
    });

    const toggle = await screen.findByRole('switch', { name: 'Graded work' });
    await user.click(toggle);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't save.",
    );
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it('offers to try again when the list cannot be loaded', async () => {
    open({
      'notification.preferences': () => {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'Down');
      },
    });

    expect(
      await screen.findByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument();
  });
});

describe('the notification settings page, as a page', () => {
  it('names the tab', () => {
    renderWithCoreApi(<NotificationSettings />, {
      handlers: { 'notification.preferences': () => preferences },
    });

    expect(document.title).toBe('Notification settings · Settings · Discava');
  });
});
