/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useUnsavedChangesGuard } from './use-unsaved-changes-guard';

function Editor({ dirty }: { dirty: boolean }) {
  const { confirmation } = useUnsavedChangesGuard(dirty);
  return (
    <>
      <h1>Editor</h1>
      <Link to="/other">Other page</Link>
      {confirmation}
    </>
  );
}

async function renderEditor(dirty: boolean) {
  const root = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Editor dirty={dirty} />,
  });
  const other = createRoute({
    getParentRoute: () => root,
    path: '/other',
    component: () => <h1>Other</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([index, other]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: 'Editor' });
}

describe('useUnsavedChangesGuard', () => {
  it('lets navigation proceed when nothing is unsaved', async () => {
    await renderEditor(false);
    await userEvent.click(screen.getByRole('link', { name: 'Other page' }));
    expect(
      await screen.findByRole('heading', { name: 'Other' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Leave without saving?')).toBeNull();
  });

  it('asks first when something is unsaved, and Stay keeps the page', async () => {
    await renderEditor(true);
    await userEvent.click(screen.getByRole('link', { name: 'Other page' }));
    expect(
      await screen.findByText('Leave without saving?'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stay' }));
    await waitFor(() =>
      expect(screen.queryByText('Leave without saving?')).toBeNull(),
    );
    expect(screen.getByRole('heading', { name: 'Editor' })).toBeInTheDocument();
  });

  it('navigates on Leave', async () => {
    await renderEditor(true);
    await userEvent.click(screen.getByRole('link', { name: 'Other page' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    expect(
      await screen.findByRole('heading', { name: 'Other' }),
    ).toBeInTheDocument();
  });
});
