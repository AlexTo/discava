/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type Handler,
  renderWithInstructorApi,
} from '../../../../test/render-with-instructor-api';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, {
    useLocation: () => ({ pathname: '/my-courses/c1/coupons' }),
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  });
});

const { Route } = await import('./coupons');
const RouteComponent = Route.options.component!;

const course = (priceAmount = 5000) => ({
  courseId: 'c1',
  title: 'Course',
  priceAmount,
  priceCurrency: 'USD',
});

const coupon = (extra: Record<string, unknown> = {}) => ({
  code: 'SPRING-25',
  type: 'percent',
  value: 20,
  redeemedCount: 3,
  maxRedemptions: 10,
  expiresAt: '2026-11-30T23:59:59.999Z',
  enabled: true,
  status: 'active',
  ...extra,
});

const render = (handlers: Record<string, Handler>) =>
  renderWithInstructorApi(<RouteComponent />, {
    handlers: {
      'course.view': () => course(),
      'coupon.list': () => ({ items: [coupon()] }),
      ...handlers,
    },
  });

const callsTo = (rendered: ReturnType<typeof render>, path: string) =>
  rendered.calls.filter((call) => call.path === path);

beforeEach(() => {
  vi.spyOn(Route, 'useParams').mockReturnValue({ courseId: 'c1' });
});

describe('Coupons screen', () => {
  it('lists each code with its value, expiry, use and status', async () => {
    render({
      'coupon.list': () => ({
        items: [
          coupon(),
          coupon({
            code: 'FIVE-OFF',
            type: 'fixed',
            value: 500,
            currency: 'USD',
            expiresAt: undefined,
            maxRedemptions: undefined,
            redeemedCount: 0,
            enabled: false,
            status: 'disabled',
          }),
        ],
      }),
    });

    expect(await screen.findByText('SPRING-25')).toBeInTheDocument();
    expect(screen.getByText(/20% off/)).toBeInTheDocument();
    expect(screen.getByText(/Ends 30 Nov, UTC/)).toBeInTheDocument();
    expect(screen.getByText(/3 of 10 used/)).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText(/\$5\.00 off/)).toBeInTheDocument();
    expect(screen.getByText(/No expiry/)).toBeInTheDocument();
    expect(screen.getByText(/· 0 used$/)).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('shows the empty state with a Create code button', async () => {
    render({ 'coupon.list': () => ({ items: [] }) });

    expect(await screen.findByText('No codes yet')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create code' }),
    ).toBeInTheDocument();
  });

  it('shows a message and no Create button for a free course', async () => {
    render({
      'course.view': () => course(0),
      'coupon.list': () => ({ items: [] }),
    });

    expect(
      await screen.findByText('Set a price on this course to create codes'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create code' })).toBeNull();
  });

  it('shows Try again when the list fails, and loads on retry', async () => {
    let fail = true;
    const { user } = render({
      'coupon.list': () => {
        if (fail) {
          throw new ApiError('INTERNAL_SERVER_ERROR', 'boom');
        }
        return { items: [coupon()] };
      },
    });

    const retry = await screen.findByRole('button', { name: 'Try again' });
    fail = false;
    await user.click(retry);
    expect(await screen.findByText('SPRING-25')).toBeInTheDocument();
  });

  describe('create', () => {
    const open = async (rendered: ReturnType<typeof render>) => {
      await rendered.user.click(
        await screen.findByRole('button', { name: 'Create code' }),
      );
      return screen.findByRole('dialog');
    };
    const empty = { 'coupon.list': () => ({ items: [] }) };

    it('sends a percent with the optional expiry and limit', async () => {
      const rendered = render({
        ...empty,
        'coupon.create': (input) => coupon(input as object),
      });
      const dialog = await open(rendered);
      const { user } = rendered;

      await user.type(within(dialog).getByLabelText('Code (optional)'), 'abcd');
      await user.type(within(dialog).getByLabelText('Percent'), '15');
      await user.type(
        within(dialog).getByLabelText('Expires on (optional)'),
        '2099-01-31',
      );
      await user.type(
        within(dialog).getByLabelText('Maximum redemptions (optional)'),
        '5',
      );
      await user.click(within(dialog).getByRole('button', { name: 'Create' }));

      await waitFor(() =>
        expect(callsTo(rendered, 'coupon.create')).toHaveLength(1),
      );
      expect(callsTo(rendered, 'coupon.create')[0]!.input).toEqual({
        courseId: 'c1',
        code: 'abcd',
        type: 'percent',
        value: 15,
        expiresOn: '2099-01-31',
        maxRedemptions: 5,
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('converts a fixed amount to minor units', async () => {
      const rendered = render({
        ...empty,
        'coupon.create': (input) => coupon(input as object),
      });
      const dialog = await open(rendered);

      await rendered.user.selectOptions(
        within(dialog).getByLabelText('Type'),
        'fixed',
      );
      await rendered.user.type(
        within(dialog).getByLabelText('Amount (USD)'),
        '12.50',
      );
      await rendered.user.click(
        within(dialog).getByRole('button', { name: 'Create' }),
      );

      await waitFor(() =>
        expect(callsTo(rendered, 'coupon.create')).toHaveLength(1),
      );
      expect(callsTo(rendered, 'coupon.create')[0]!.input).toEqual({
        courseId: 'c1',
        type: 'fixed',
        value: 1250,
      });
    });

    it('leaves the code empty for the server after Generate', async () => {
      const rendered = render({
        ...empty,
        'coupon.create': (input) => coupon(input as object),
      });
      const dialog = await open(rendered);
      const { user } = rendered;

      await user.type(within(dialog).getByLabelText('Code (optional)'), 'abcd');
      await user.click(
        within(dialog).getByRole('button', { name: 'Generate' }),
      );
      await user.type(within(dialog).getByLabelText('Percent'), '10');
      await user.click(within(dialog).getByRole('button', { name: 'Create' }));

      await waitFor(() =>
        expect(callsTo(rendered, 'coupon.create')).toHaveLength(1),
      );
      expect(callsTo(rendered, 'coupon.create')[0]!.input).not.toHaveProperty(
        'code',
      );
    });

    it('shows a duplicate on the Code field and keeps the dialog', async () => {
      const rendered = render({
        ...empty,
        'coupon.create': () => {
          throw new ApiError(
            'CONFLICT',
            'This code already exists for the course',
          );
        },
      });
      const dialog = await open(rendered);
      const { user } = rendered;

      await user.type(within(dialog).getByLabelText('Code (optional)'), 'abcd');
      await user.type(within(dialog).getByLabelText('Percent'), '10');
      await user.click(within(dialog).getByRole('button', { name: 'Create' }));

      const field = within(dialog).getByLabelText('Code (optional)');
      await waitFor(() => expect(field).toBeInvalid());
      expect(
        within(dialog).getByText('This code already exists for the course'),
      ).toBeInTheDocument();
    });

    it('refuses a bad percent without calling the API', async () => {
      const rendered = render(empty);
      const dialog = await open(rendered);

      await rendered.user.type(within(dialog).getByLabelText('Percent'), '150');
      await rendered.user.click(
        within(dialog).getByRole('button', { name: 'Create' }),
      );

      expect(
        await within(dialog).findByText(/whole percentage from 1 to 100/),
      ).toBeInTheDocument();
      expect(callsTo(rendered, 'coupon.create')).toHaveLength(0);
    });
  });

  describe('row actions', () => {
    it('disables an active code', async () => {
      const rendered = render({ 'coupon.update': () => coupon() });

      await rendered.user.click(
        await screen.findByRole('button', { name: 'Disable SPRING-25' }),
      );

      await waitFor(() =>
        expect(callsTo(rendered, 'coupon.update')).toHaveLength(1),
      );
      expect(callsTo(rendered, 'coupon.update')[0]!.input).toEqual({
        courseId: 'c1',
        code: 'SPRING-25',
        enabled: false,
      });
    });

    it('enables a disabled code', async () => {
      const rendered = render({
        'coupon.list': () => ({
          items: [coupon({ enabled: false, status: 'disabled' })],
        }),
        'coupon.update': () => coupon(),
      });

      await rendered.user.click(
        await screen.findByRole('button', { name: 'Enable SPRING-25' }),
      );

      await waitFor(() =>
        expect(callsTo(rendered, 'coupon.update')[0]?.input).toEqual({
          courseId: 'c1',
          code: 'SPRING-25',
          enabled: true,
        }),
      );
    });

    it('edits only expiry and limit, with the held count as the hint', async () => {
      const rendered = render({ 'coupon.update': () => coupon() });
      const { user } = rendered;

      await user.click(
        await screen.findByRole('button', {
          name: 'Edit limits for SPRING-25',
        }),
      );
      const dialog = await screen.findByRole('dialog');

      expect(within(dialog).getByText(/At least 3/)).toBeInTheDocument();
      expect(within(dialog).getByLabelText('Expires on')).toHaveValue(
        '2026-11-30',
      );
      expect(within(dialog).queryByLabelText(/^Code/)).toBeNull();
      expect(within(dialog).queryByLabelText(/^Type/)).toBeNull();
      expect(
        within(dialog).queryByLabelText(/^Value|^Percent|^Amount/),
      ).toBeNull();

      const limit = within(dialog).getByLabelText('Maximum redemptions');
      await user.clear(limit);
      await user.type(limit, '4');
      await user.clear(within(dialog).getByLabelText('Expires on'));
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(callsTo(rendered, 'coupon.update')).toHaveLength(1),
      );
      expect(callsTo(rendered, 'coupon.update')[0]!.input).toEqual({
        courseId: 'c1',
        code: 'SPRING-25',
        expiresOn: null,
        maxRedemptions: 4,
      });
    });

    it('shows a refused limit in the dialog and keeps it open', async () => {
      const rendered = render({
        'coupon.update': () => {
          throw new ApiError(
            'PRECONDITION_FAILED',
            'The limit cannot be below the 3 redemptions already held',
          );
        },
      });
      const { user } = rendered;

      await user.click(
        await screen.findByRole('button', {
          name: 'Edit limits for SPRING-25',
        }),
      );
      const dialog = await screen.findByRole('dialog');
      const limit = within(dialog).getByLabelText('Maximum redemptions');
      await user.clear(limit);
      await user.type(limit, '2');
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));

      expect(
        await within(dialog).findByText(
          'The limit cannot be below the 3 redemptions already held',
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(limit).toHaveValue('2');
    });

    it('deletes an unused code after a confirmation', async () => {
      const rendered = render({
        'coupon.list': () => ({ items: [coupon({ redeemedCount: 0 })] }),
        'coupon.delete': () => ({ success: true }),
      });
      const { user } = rendered;

      await user.click(
        await screen.findByRole('button', { name: 'Delete SPRING-25' }),
      );
      expect(callsTo(rendered, 'coupon.delete')).toHaveLength(0);
      const dialog = await screen.findByRole('alertdialog');
      await user.click(
        within(dialog).getByRole('button', { name: 'Delete code' }),
      );

      await waitFor(() =>
        expect(callsTo(rendered, 'coupon.delete')).toHaveLength(1),
      );
      expect(callsTo(rendered, 'coupon.delete')[0]!.input).toEqual({
        courseId: 'c1',
        code: 'SPRING-25',
      });
    });

    it('offers no Delete when the code has redemptions', async () => {
      render({});

      await screen.findByText('SPRING-25');
      expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
    });
  });
});
