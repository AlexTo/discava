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
import { PaymentsScreen } from './payments-screen';

const KEY = 'sk_test_SECRET1234';

const active = {
  state: 'active',
  mode: 'test',
  accountName: 'Local Stripe Account',
  keyLast4: '1234',
  changedByName: 'Carol Admin',
  changedAt: '2026-11-18T10:00:00.000Z',
  changes: [
    {
      kind: 'connected',
      byName: 'Carol Admin',
      at: '2026-11-18T10:00:00.000Z',
      mode: 'test',
      keyLast4: '1234',
    },
    {
      kind: 'failed',
      byName: 'Carol Admin',
      at: '2026-11-17T10:00:00.000Z',
      step: 'registration',
    },
  ],
};
const notConnected = { state: 'not-connected', changes: [] };

const render = (status: object, handlers: Record<string, Handler> = {}) =>
  renderWithAdminApi(<PaymentsScreen />, {
    handlers: { 'payment.status': () => status, ...handlers },
  });

const keyField = () => screen.getByLabelText('Stripe secret key');

describe('the Payments page', () => {
  it.each([['not-connected'], ['disconnected']])(
    'offers to connect when the state is %s',
    async (state) => {
      render({ state, changes: [] });

      expect(
        await screen.findByText(
          "Stripe isn't connected. Students can't buy courses until it is.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Connect Stripe' }),
      ).toBeInTheDocument();
      expect(keyField()).toHaveAttribute('type', 'password');
      expect(keyField()).toHaveAttribute('autocomplete', 'off');
    },
  );

  it('shows the connection in test mode with a warning', async () => {
    render(active);

    expect(await screen.findByText('Test mode')).toBeInTheDocument();
    expect(screen.getAllByText('Connected')).toHaveLength(2);
    expect(screen.getByText('Test mode')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Students pay with test cards and are enrolled for free.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Local Stripe Account')).toBeInTheDocument();
    expect(screen.getByText('Key ending ····1234')).toBeInTheDocument();
    expect(screen.getByText(/Changed by Carol Admin on/)).toBeInTheDocument();
  });

  it('shows live mode without the test warning', async () => {
    render({ ...active, mode: 'live' });

    expect(await screen.findByText('Live mode')).toBeInTheDocument();
    expect(screen.queryByText(/test cards/)).not.toBeInTheDocument();
  });

  it('lists the recent changes, naming the step of a failure', async () => {
    render(active);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Connected')).toBeInTheDocument();
    expect(
      within(table).getByText(
        "Failed: the confirmation address couldn't be registered",
      ),
    ).toBeInTheDocument();
  });

  it('scrolls the recent changes inside a named, focusable region', async () => {
    render(active);

    const region = await screen.findByRole('region', {
      name: 'Recent changes',
    });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveClass('overflow-x-auto');
    expect(within(region).getByRole('table')).toHaveClass('min-w-[36rem]');
  });

  it('disables the buttons and polls while a change is in progress', async () => {
    const rendered = render({ ...active, state: 'changing' });

    expect(await screen.findByText('A change is in progress')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Replace key' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeDisabled();
    expect(
      rendered.calls.filter((c) => c.path === 'payment.status'),
    ).toHaveLength(1);
  });

  it('says when the confirmation address has changed', async () => {
    render({ ...active, addressChanged: true });

    expect(
      await screen.findByText(/Save the key again to register it/),
    ).toBeInTheDocument();
  });

  it('connects, then empties the field and shows the connection', async () => {
    const rendered = render(notConnected, {
      'payment.connect': () => active,
    });
    await rendered.user.type(
      await screen.findByLabelText('Stripe secret key'),
      KEY,
    );
    await rendered.user.click(
      screen.getByRole('button', { name: 'Connect Stripe' }),
    );

    expect(await screen.findByText('Test mode')).toBeInTheDocument();
    expect(rendered.calls).toContainEqual({
      path: 'payment.connect',
      input: { secretKey: KEY },
    });
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it('empties the field and shows the message when the save fails', async () => {
    const rendered = render(notConnected, {
      'payment.connect': () => {
        throw new ApiError('BAD_REQUEST', 'Stripe rejected this key');
      },
    });
    await rendered.user.type(
      await screen.findByLabelText('Stripe secret key'),
      KEY,
    );
    await rendered.user.click(
      screen.getByRole('button', { name: 'Connect Stripe' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Stripe rejected this key',
    );
    expect(keyField()).toHaveValue('');
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it('never has the typed key in the page, even before it is sent', async () => {
    const rendered = render(notConnected);
    await rendered.user.type(
      await screen.findByLabelText('Stripe secret key'),
      KEY,
    );

    expect(document.body.innerHTML).not.toContain(KEY);
    for (const element of document.body.querySelectorAll('*')) {
      for (const attribute of element.getAttributeNames()) {
        expect(element.getAttribute(attribute)).not.toContain(KEY);
      }
    }
  });

  it('asks before disconnecting', async () => {
    const rendered = render(active, {
      'payment.disconnect': () => ({ state: 'disconnected', changes: [] }),
    });
    await rendered.user.click(
      await screen.findByRole('button', { name: 'Disconnect' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(rendered.calls.some((c) => c.path === 'payment.disconnect')).toBe(
      false,
    );
    await rendered.user.click(
      within(dialog).getByRole('button', { name: 'Disconnect Stripe' }),
    );

    expect(
      await screen.findByRole('button', { name: 'Connect Stripe' }),
    ).toBeInTheDocument();
  });

  it('does not disconnect when the confirmation is declined', async () => {
    const rendered = render(active);
    await rendered.user.click(
      await screen.findByRole('button', { name: 'Disconnect' }),
    );
    await rendered.user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Keep connected',
      }),
    );

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(rendered.calls.some((c) => c.path === 'payment.disconnect')).toBe(
      false,
    );
  });

  it('asks about a different account before replacing the key', async () => {
    const rendered = render(active, { 'payment.connect': () => active });
    await rendered.user.click(
      await screen.findByRole('button', { name: 'Replace key' }),
    );
    await rendered.user.type(keyField(), KEY);
    await rendered.user.click(screen.getByRole('button', { name: 'Save key' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('different Stripe account');
    expect(dialog).toHaveTextContent('Local Stripe Account');
    expect(rendered.calls.some((c) => c.path === 'payment.connect')).toBe(
      false,
    );
    expect(keyField()).toHaveValue('');
    await rendered.user.click(
      within(dialog).getByRole('button', { name: 'Continue' }),
    );

    await waitFor(() =>
      expect(rendered.calls).toContainEqual({
        path: 'payment.connect',
        input: { secretKey: KEY },
      }),
    );
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it('shows a conflict with its end time', async () => {
    const message =
      'Checkouts are open until 2026-11-19T10:30:00.000Z; try again after';
    const rendered = render(active, {
      'payment.connect': () => {
        throw new ApiError('CONFLICT', message);
      },
    });
    await rendered.user.click(
      await screen.findByRole('button', { name: 'Replace key' }),
    );
    await rendered.user.type(keyField(), KEY);
    await rendered.user.click(screen.getByRole('button', { name: 'Save key' }));
    await rendered.user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Continue',
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('shows an error with a retry when the status fails to load', async () => {
    let fail = true;
    const rendered = renderWithAdminApi(<PaymentsScreen />, {
      handlers: {
        'payment.status': () => {
          if (fail) throw new ApiError('INTERNAL_SERVER_ERROR', 'Boom');
          return active;
        },
      },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on our side. Try again in a moment.',
    );
    fail = false;
    await rendered.user.click(
      screen.getByRole('button', { name: 'Try again' }),
    );

    expect(await screen.findByText('Test mode')).toBeInTheDocument();
  });
});

describe('the Payments page, as a page', () => {
  it('names the tab and says it is loading the payment settings', () => {
    render(notConnected, { 'payment.status': () => new Promise(() => {}) });

    expect(document.title).toBe('Payments · Discava');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Payments' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading the payment settings…',
    );
  });
});
