/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type Handler,
  renderWithInstructorApi,
} from '../../../test/render-with-instructor-api';
import { Route } from './route';

const EarningsPage = Route.options.component!;

const totals = {
  orders: 3,
  grossMinor: 30000,
  discountMinor: 3000,
  refundMinor: 2000,
  feeMinor: 5000,
  netMinor: 20000,
};
const row = (courseId: string, courseTitle: string, over = {}) => ({
  courseId,
  courseTitle,
  orders: 2,
  grossMinor: 20000,
  discountMinor: 2000,
  refundMinor: 2000,
  feeMinor: 3000,
  netMinor: 13000,
  ...over,
});
const report = {
  currencies: [
    {
      currency: 'USD',
      courses: [
        row('c1', 'Intro to DynamoDB'),
        row('c2', 'Advanced Queries', {
          orders: 1,
          grossMinor: 10000,
          discountMinor: 1000,
          refundMinor: 0,
          feeMinor: 2000,
          netMinor: 7000,
        }),
      ],
      totals,
    },
  ],
};
const line = (n: number, over = {}) => ({
  entryId: `e${n}`,
  kind: 'sale',
  orderId: `order-${n}`,
  occurredAt: '2026-11-05T10:00:00.000Z',
  currency: 'USD',
  grossMinor: 10000,
  discountMinor: 1000,
  refundMinor: 0,
  feeMinor: 1500,
  netMinor: 7500,
  ...over,
});
const overview = {
  currencies: [
    {
      currency: 'USD',
      onHoldMinor: 5000,
      waitingMinor: 0,
      readyMinor: 7500,
      heldMinor: 0,
      nextReleaseAt: '2026-11-25T00:00:00.000Z',
    },
  ],
  payouts: [],
};

const open = (handlers: Record<string, Handler> = {}) =>
  renderWithInstructorApi(<EarningsPage />, {
    handlers: {
      'earnings.report': () => report,
      'earnings.lines': () => ({ lines: [] }),
      'payout.account': () => ({ status: 'active' }),
      'payout.overview': () => overview,
      ...handlers,
    },
  });

describe('earnings report', () => {
  it('shows a table per currency whose figures match the report', async () => {
    open();

    const table = await screen.findByRole('table', { name: 'Earnings in USD' });
    const first = within(table).getByText('Intro to DynamoDB').closest('tr')!;
    expect(
      within(first)
        .getAllByRole('cell')
        .map((cell) => cell.textContent?.replace('Show orders', '')),
    ).toEqual([
      'Intro to DynamoDB',
      '2',
      '$200.00',
      '$20.00',
      '$20.00',
      '$30.00',
      '$130.00',
    ]);
    const total = within(table).getByText('Total').closest('tr')!;
    expect(
      within(total)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Total',
      '3',
      '$300.00',
      '$30.00',
      '$20.00',
      '$50.00',
      '$200.00',
    ]);
  });

  it('spaces its columns and keeps each amount on one line', async () => {
    open();

    const table = await screen.findByRole('table', { name: 'Earnings in USD' });
    for (const cell of [
      ...within(table).getAllByRole('columnheader'),
      ...within(table).getAllByRole('cell'),
    ]) {
      expect(cell).toHaveClass('px-2');
    }
    const first = within(table).getByText('Intro to DynamoDB').closest('tr')!;
    for (const amount of within(first).getAllByRole('cell').slice(1)) {
      expect(amount).toHaveClass('whitespace-nowrap');
    }
  });

  it('asks for the current UTC month by default', async () => {
    const { calls } = open();

    await screen.findByRole('table', { name: 'Earnings in USD' });
    const input = calls.find(({ path }) => path === 'earnings.report')!
      .input as { from: string; to: string };
    expect(input.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(input.to.slice(0, 7)).toBe(input.from.slice(0, 7));
  });

  it('shows the empty state when there are no sales', async () => {
    open({ 'earnings.report': () => ({ currencies: [] }) });

    expect(
      await screen.findByText('No sales in this period'),
    ).toBeInTheDocument();
  });

  it("loads a course's orders, then more of them", async () => {
    const lines = vi.fn((input: unknown) =>
      (input as { cursor?: string }).cursor
        ? { lines: [line(3, { kind: 'refund', refundMinor: 500 })] }
        : { lines: [line(1), line(2)], nextCursor: 'next' },
    );
    const { user } = open({ 'earnings.lines': lines });

    await screen.findByRole('table', { name: 'Earnings in USD' });
    await user.click(
      screen.getAllByRole('button', { name: 'Show orders' })[0]!,
    );

    const orders = await screen.findByRole('table', { name: 'Orders' });
    expect(within(orders).getByText('order-1')).toBeInTheDocument();
    expect(within(orders).getByText('order-2')).toBeInTheDocument();
    expect(within(orders).getAllByText('Sale')).toHaveLength(2);
    expect(lines).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'c1' }),
    );

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await within(orders).findByText('order-3')).toBeInTheDocument();
    expect(
      within(within(orders).getByText('order-3').closest('tr')!).getByText(
        'Refund',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it("shows the API's message for an invalid range", async () => {
    const message =
      'Choose a period of at most 366 days that ends after it starts';
    const { user } = open({
      'earnings.report': (input) => {
        if ((input as { to: string }).to === '2020-01-01') {
          throw new ApiError('BAD_REQUEST', message);
        }
        return report;
      },
    });

    await screen.findByRole('table', { name: 'Earnings in USD' });
    await user.click(screen.getByRole('button', { name: 'Custom range' }));
    const to = screen.getByLabelText('To');
    await user.clear(to);
    await user.type(to, '2020-01-01');

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('keeps the other sections when one fails', async () => {
    open({
      'earnings.report': () => {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'The report is down');
      },
    });

    expect(
      await screen.findByText(
        'Something went wrong on our side. Try again in a moment.',
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText('Status:')).toBeInTheDocument();
    expect(
      await screen.findByText('Next release 25 Nov 2026'),
    ).toBeInTheDocument();
  });
});

describe('payout account', () => {
  const assign = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('location', { ...window.location, assign });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    assign.mockReset();
  });

  it.each([
    ['not_started', 'Not set up', 'Set up payouts'],
    ['in_progress', 'In progress', 'Continue setup'],
    ['active', 'Active', 'Open Stripe dashboard'],
    ['restricted', 'Restricted', 'Fix account'],
  ])('shows %s with one action', async (status, label, action) => {
    open({ 'payout.account': () => ({ status }) });

    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: action })).toBeInTheDocument();
    const actions = [
      'Set up payouts',
      'Continue setup',
      'Open Stripe dashboard',
      'Fix account',
    ];
    expect(
      screen
        .getAllByRole('button')
        .filter((button) => actions.includes(button.textContent ?? '')),
    ).toHaveLength(1);
  });

  it('offers no action when payouts are unavailable', async () => {
    open({ 'payout.account': () => ({ status: 'unavailable' }) });

    expect(
      await screen.findByText("Payouts aren't available yet"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /set up|continue|fix|dashboard/i }),
    ).toBeNull();
  });

  it('starts onboarding with a return path and redirects', async () => {
    const startOnboarding = vi.fn(() => ({
      url: 'https://stripe.test/onboard',
    }));
    const { user } = open({
      'payout.account': () => ({ status: 'not_started' }),
      'payout.startOnboarding': startOnboarding,
    });

    await user.click(
      await screen.findByRole('button', { name: 'Set up payouts' }),
    );

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://stripe.test/onboard'),
    );
    expect(startOnboarding).toHaveBeenCalledWith({ returnPath: '/earnings' });
  });

  it('opens the Stripe dashboard', async () => {
    const { user } = open({
      'payout.dashboardLink': () => ({ url: 'https://stripe.test/dash' }),
    });

    await user.click(
      await screen.findByRole('button', { name: 'Open Stripe dashboard' }),
    );

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://stripe.test/dash'),
    );
  });

  it('shows why onboarding could not start', async () => {
    const { user } = open({
      'payout.account': () => ({ status: 'not_started' }),
      'payout.startOnboarding': () => {
        throw new ApiError(
          'PRECONDITION_FAILED',
          "This platform can't set up payout accounts yet",
        );
      },
    });

    await user.click(
      await screen.findByRole('button', { name: 'Set up payouts' }),
    );

    expect(
      await screen.findByText("This platform can't set up payout accounts yet"),
    ).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('notes a stored status when Stripe is unavailable', async () => {
    open({ 'payout.account': () => ({ status: 'active', stale: true }) });

    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(screen.getByText(/Stripe can't be reached/)).toBeInTheDocument();
  });
});

describe('balance and payouts', () => {
  it('shows each bucket and the next release date', async () => {
    open({
      'payout.overview': () => ({
        currencies: [
          {
            currency: 'USD',
            onHoldMinor: 5000,
            waitingMinor: 1200,
            readyMinor: 7500,
            heldMinor: 0,
            nextReleaseAt: '2026-11-25T00:00:00.000Z',
          },
        ],
        payouts: [],
      }),
    });

    const hold = (await screen.findByText('On hold')).nextSibling!;
    expect(hold).toHaveTextContent('$50.00');
    expect(hold).toHaveTextContent('Next release 25 Nov 2026');
    expect(
      screen.getByText('Waiting for account setup').nextSibling,
    ).toHaveTextContent('$12.00');
    expect(screen.getByText('Ready').nextSibling).toHaveTextContent('$75.00');
    expect(screen.queryByText(/Held:/)).toBeNull();
    expect(screen.getByText('No payouts yet.')).toBeInTheDocument();
  });

  it('explains a negative balance as a deduction', async () => {
    open({
      'payout.overview': () => ({
        currencies: [
          {
            currency: 'USD',
            onHoldMinor: 0,
            waitingMinor: 0,
            readyMinor: -2500,
            heldMinor: 0,
          },
        ],
        payouts: [],
      }),
    });

    expect((await screen.findByText('Ready')).nextSibling).toHaveTextContent(
      '-$25.00',
    );
    expect(
      screen.getByText(/deducted from your next payout/),
    ).toBeInTheDocument();
  });

  it('shows held earnings with their explanation only when there are some', async () => {
    open({
      'payout.overview': () => ({
        currencies: [
          {
            currency: 'USD',
            onHoldMinor: 0,
            waitingMinor: 0,
            readyMinor: 0,
            heldMinor: 4000,
          },
        ],
        payouts: [],
      }),
    });

    expect(
      await screen.findByText('$40.00', { selector: 'span' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Earned before the platform changed its payment account. Contact the platform to be paid.',
      ),
    ).toBeInTheDocument();
  });

  it('lists payouts as Pending, Sent and Failed with the reason', async () => {
    const payout = (payoutId: string, status: string, over = {}) => ({
      payoutId,
      currency: 'USD',
      amountMinor: 1000,
      status,
      createdAt: '2026-11-10T00:00:00.000Z',
      ...over,
    });
    open({
      'payout.overview': () => ({
        currencies: [],
        payouts: [
          payout('p1', 'pending'),
          payout('p2', 'sent'),
          payout('p3', 'failed', { failureReason: 'Account closed' }),
        ],
      }),
    });

    const table = await screen.findByRole('table', { name: 'Payouts' });
    const statuses = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((tr) => within(tr).getAllByRole('cell')[2]!.textContent);
    expect(statuses).toEqual(['Pending', 'Sent', 'Failed: Account closed']);
  });

  it('shows an error for the balance while the report stays', async () => {
    open({
      'payout.overview': () => {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'Balances are down');
      },
    });

    expect(
      await screen.findAllByText(
        'Something went wrong on our side. Try again in a moment.',
      ),
    ).not.toHaveLength(0);
    expect(
      await screen.findByRole('table', { name: 'Earnings in USD' }),
    ).toBeInTheDocument();
  });
});
