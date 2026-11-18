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
import { CategoriesScreen } from './-categories-screen';

const science = {
  id: 'c1',
  name: 'Science',
  slug: 'science',
  status: 'active',
  courseCount: 2,
};
const maths = {
  id: 'c2',
  name: 'Mathematics',
  slug: 'mathematics',
  status: 'archived',
  courseCount: 0,
};

const render = (handlers: Record<string, Handler> = {}) =>
  renderWithAdminApi(<CategoriesScreen />, {
    handlers: { 'category.list': () => [science, maths], ...handlers },
  });

const row = (name: string) =>
  screen.getByRole('row', { name: new RegExp(name) });

describe('the Categories screen', () => {
  it('lists every category with its slug, status and course count', async () => {
    render();

    const science = await screen.findByRole('row', { name: /Science/ });
    expect(within(science).getByText('science')).toBeInTheDocument();
    expect(within(science).getByText('Active')).toBeInTheDocument();
    expect(within(science).getByText('2')).toBeInTheDocument();
    expect(
      within(row('Mathematics')).getByText('Archived'),
    ).toBeInTheDocument();
    // An archived category can't be archived again.
    expect(
      within(row('Mathematics')).queryByRole('button', { name: 'Archive' }),
    ).not.toBeInTheDocument();
  });

  it('adds a category and reloads the table', async () => {
    const { user, calls } = render({ 'category.create': () => science });
    await screen.findByRole('row', { name: /Science/ });

    await user.type(screen.getByLabelText('New category name'), 'Business');
    await user.click(screen.getByRole('button', { name: 'Add category' }));

    await waitFor(() =>
      expect(calls.filter((c) => c.path === 'category.list')).toHaveLength(2),
    );
    expect(calls).toContainEqual({
      path: 'category.create',
      input: { name: 'Business' },
    });
    expect(screen.getByLabelText('New category name')).toHaveValue('');
  });

  it('shows the error when the name is taken', async () => {
    const { user } = render({
      'category.create': () => {
        throw new ApiError(
          'CONFLICT',
          'A category named "Science" already exists',
        );
      },
    });
    await screen.findByRole('row', { name: /Science/ });

    await user.type(screen.getByLabelText('New category name'), 'science');
    await user.click(screen.getByRole('button', { name: 'Add category' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A category named "Science" already exists',
    );
  });

  it('renames a category inline', async () => {
    const { user, calls } = render({ 'category.rename': () => science });
    await screen.findByRole('row', { name: /Science/ });

    await user.click(
      within(row('Science')).getByRole('button', { name: 'Rename' }),
    );
    const input = screen.getByLabelText('New name for Science');
    await user.clear(input);
    await user.type(input, 'Sciences');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        path: 'category.rename',
        input: { id: 'c1', name: 'Sciences' },
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByLabelText('New name for Science'),
      ).not.toBeInTheDocument(),
    );
  });

  it('keeps the rename form open and shows the error when the name is taken', async () => {
    const { user } = render({
      'category.rename': () => {
        throw new ApiError(
          'CONFLICT',
          'A category named "Maths" already exists',
        );
      },
    });
    await screen.findByRole('row', { name: /Science/ });

    await user.click(
      within(row('Science')).getByRole('button', { name: 'Rename' }),
    );
    const input = screen.getByLabelText('New name for Science');
    await user.clear(input);
    await user.type(input, 'Maths');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'already exists',
    );
    expect(screen.getByLabelText('New name for Science')).toBeInTheDocument();
  });

  it('asks before archiving, and archives on confirmation', async () => {
    const { user, calls } = render({ 'category.archive': () => science });
    await screen.findByRole('row', { name: /Science/ });

    await user.click(
      within(row('Science')).getByRole('button', { name: 'Archive' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Archive Science?');
    expect(dialog).toHaveTextContent('2 courses keep it');
    expect(calls.some((c) => c.path === 'category.archive')).toBe(false);

    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        path: 'category.archive',
        input: { id: 'c1' },
      }),
    );
  });

  it('does not archive when the confirmation is cancelled', async () => {
    const { user, calls } = render();
    await screen.findByRole('row', { name: /Science/ });

    await user.click(
      within(row('Science')).getByRole('button', { name: 'Archive' }),
    );
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Cancel',
      }),
    );

    expect(calls.some((c) => c.path === 'category.archive')).toBe(false);
  });
});
