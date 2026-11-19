/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type Handler,
  renderWithAdminApi,
} from '../test/render-with-admin-api';
import { Route } from './index';

// Link needs a router context this test doesn't set up; a plain anchor keeps
// its `to` as the href, which shows where each card leads.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, {
    Link: ({
      children,
      to,
      className,
    }: {
      children: React.ReactNode;
      to: string;
      className?: string;
    }) => (
      <a href={to} className={className}>
        {children}
      </a>
    ),
  });
});

const AdminHome = Route.options.component!;

const render = (handlers: Record<string, Handler> = {}) =>
  renderWithAdminApi(<AdminHome />, {
    handlers: {
      'category.list': () => [
        {
          categoryId: 'a',
          name: 'Art',
          slug: 'art',
          status: 'active',
          courseCount: 1,
        },
        {
          categoryId: 'b',
          name: 'Old',
          slug: 'old',
          status: 'archived',
          courseCount: 0,
        },
      ],
      'review.courses': () => ({
        items: [
          {
            courseId: 'c1',
            title: 'Physics',
            status: 'published',
            ratingCount: 2,
          },
          {
            courseId: 'c2',
            title: 'Maths',
            status: 'published',
            ratingCount: 3,
          },
        ],
      }),
      ...handlers,
    },
  });

describe('the admin home page', () => {
  it('is not the scaffold', async () => {
    render();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Admin' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/new React website/)).not.toBeInTheDocument();
  });

  it('links to each admin area with a description', async () => {
    render();

    const links = await screen.findAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/categories',
      '/reviews',
      '/settings/notifications',
    ]);
    expect(screen.getByText('Notification settings')).toBeInTheDocument();
    expect(
      screen.getByText(/Choose which notifications also reach you/),
    ).toBeInTheDocument();
  });

  it('shows figures from the admin API', async () => {
    render();

    expect(await screen.findByText('1 active category')).toBeInTheDocument();
    expect(
      await screen.findByText('5 ratings across courses'),
    ).toBeInTheDocument();
  });

  it('shows no figure when its query fails', async () => {
    render({
      'category.list': () => {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'boom');
      },
    });

    expect(
      await screen.findByText('5 ratings across courses'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/active categor/)).not.toBeInTheDocument();
  });
});
