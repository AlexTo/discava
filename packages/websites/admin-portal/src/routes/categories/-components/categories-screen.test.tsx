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
} from '../../../test/render-with-admin-api';
import { CategoriesScreen } from './categories-screen';

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

  it('stacks a row below sm and breaks a long name and slug', async () => {
    const longName = 'W'.repeat(60);
    const longSlug = 'w'.repeat(60);
    render({
      'category.list': () => [{ ...science, name: longName, slug: longSlug }],
    });

    const long = await screen.findByRole('row', { name: new RegExp(longName) });
    expect(long).toHaveClass('max-sm:grid');
    expect(within(long).getByText(longName).closest('td')).toHaveClass(
      'break-words',
    );
    expect(within(long).getByText(longSlug).closest('td')).toHaveClass(
      'break-all',
    );
    expect(within(long).getByText('Slug:')).toHaveClass('sm:sr-only');
    expect(within(long).getByText('Courses:')).toHaveClass('sm:sr-only');
    const rename = within(long).getByRole('button', { name: 'Rename' });
    expect(rename.parentElement).toHaveClass('flex-wrap');
    expect(
      within(long).getByRole('button', { name: 'Archive' }),
    ).toBeInTheDocument();
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

describe('the Categories screen, with the keyboard', () => {
  it('focuses the rename field, and Escape cancels back to Rename', async () => {
    const { user, calls } = render();
    await screen.findByRole('row', { name: /Science/ });

    await user.click(
      within(row('Science')).getByRole('button', { name: 'Rename' }),
    );
    expect(screen.getByLabelText('New name for Science')).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(
      screen.queryByLabelText('New name for Science'),
    ).not.toBeInTheDocument();
    expect(
      within(row('Science')).getByRole('button', { name: 'Rename' }),
    ).toHaveFocus();
    expect(calls.some((c) => c.path === 'category.rename')).toBe(false);
  });

  it('moves focus to Rename after Cancel and after Save', async () => {
    const { user } = render({ 'category.rename': () => science });
    await screen.findByRole('row', { name: /Science/ });
    const rename = () =>
      within(row('Science')).getByRole('button', { name: 'Rename' });

    await user.click(rename());
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(rename()).toHaveFocus();

    await user.click(rename());
    await user.keyboard('s{Enter}');
    await waitFor(() => expect(rename()).toHaveFocus());
  });

  it('returns focus to Archive when the confirmation is cancelled', async () => {
    const { user } = render();
    await screen.findByRole('row', { name: /Science/ });
    const archive = within(row('Science')).getByRole('button', {
      name: 'Archive',
    });

    await user.click(archive);
    await user.keyboard('{Escape}');

    await waitFor(() => expect(archive).toHaveFocus());
  });

  it('moves focus to the row’s Rename after archiving', async () => {
    let archived = false;
    const { user } = render({
      'category.list': () => [
        { ...science, status: archived ? 'archived' : 'active' },
      ],
      'category.archive': () => {
        archived = true;
        return science;
      },
    });
    await screen.findByRole('row', { name: /Science/ });

    await user.click(
      within(row('Science')).getByRole('button', { name: 'Archive' }),
    );
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Archive',
      }),
    );

    await waitFor(() =>
      expect(
        within(row('Science')).getByRole('button', { name: 'Rename' }),
      ).toHaveFocus(),
    );
  });

  it('announces what happened', async () => {
    const { user } = render({ 'category.create': () => science });
    await screen.findByRole('row', { name: /Science/ });

    await user.type(screen.getByLabelText('New category name'), 'Business');
    await user.click(screen.getByRole('button', { name: 'Add category' }));

    await waitFor(() =>
      expect(
        screen
          .getAllByRole('status')
          .some((el) => el.textContent === 'Business added.'),
      ).toBe(true),
    );
  });

  it('keeps focus on a pending button and sends nothing on a second press', async () => {
    let finish: (value: unknown) => void = () => {};
    const { user, calls } = render({
      'category.create': () => new Promise((resolve) => (finish = resolve)),
    });
    await screen.findByRole('row', { name: /Science/ });

    await user.type(screen.getByLabelText('New category name'), 'Business');
    const add = screen.getByRole('button', { name: 'Add category' });
    await user.click(add);

    const adding = await screen.findByRole('button', { name: 'Adding…' });
    expect(adding).toHaveAttribute('aria-disabled', 'true');
    expect(adding).not.toBeDisabled();
    adding.focus();
    await user.click(adding);
    expect(adding).toHaveFocus();
    expect(calls.filter((c) => c.path === 'category.create')).toHaveLength(1);
    finish(science);
  });
});

describe('the Categories screen, as a page', () => {
  it('names the tab and says what it is waiting for', () => {
    render({ 'category.list': () => new Promise(() => {}) });

    expect(document.title).toBe('Categories · Discava');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Categories' }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('status').map((status) => status.textContent),
    ).toContain('Loading the categories…');
  });
});
