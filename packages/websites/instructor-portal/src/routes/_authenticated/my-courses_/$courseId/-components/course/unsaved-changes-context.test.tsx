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
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithInstructorApi } from '../../../../../../test/render-with-instructor-api';
import { CoursePriceForm } from './course-price-form';
import { UnsavedChangesProvider } from './unsaved-changes-context';

const renderEditor = (enabled = true) => {
  const root = createRootRoute({ component: Outlet });
  const editor = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <UnsavedChangesProvider enabled={enabled}>
        <h1>Course</h1>
        <CoursePriceForm
          courseId="course-1"
          priceAmount={1999}
          priceCurrency="USD"
        />
        <Link to="/my-courses">My courses</Link>
      </UnsavedChangesProvider>
    ),
  });
  const list = createRoute({
    getParentRoute: () => root,
    path: '/my-courses',
    component: () => <h1>My courses page</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([editor, list]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return renderWithInstructorApi(<RouterProvider router={router} />);
};

describe('UnsavedChangesProvider', () => {
  it('asks "Leave without saving?" when a price form is dirty, and Stay keeps the page', async () => {
    const { user } = renderEditor();

    await user.type(await screen.findByLabelText('Price'), '0');
    await user.click(screen.getByRole('link', { name: 'My courses' }));

    expect(await screen.findByText('Leave without saving?')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.getByRole('heading', { name: 'Course' })).toBeVisible();
    expect(screen.getByLabelText('Price')).toHaveValue('19.990');
  });

  it('leaves on Leave', async () => {
    const { user } = renderEditor();

    await user.type(await screen.findByLabelText('Price'), '0');
    await user.click(screen.getByRole('link', { name: 'My courses' }));
    await user.click(await screen.findByRole('button', { name: 'Leave' }));

    expect(
      await screen.findByRole('heading', { name: 'My courses page' }),
    ).toBeVisible();
  });

  it('navigates freely when nothing was changed', async () => {
    const { user } = renderEditor();

    await user.click(await screen.findByRole('link', { name: 'My courses' }));

    expect(
      await screen.findByRole('heading', { name: 'My courses page' }),
    ).toBeVisible();
    expect(screen.queryByText('Leave without saving?')).toBeNull();
  });

  it('guards nothing for an archived course', async () => {
    const { user } = renderEditor(false);

    await user.type(await screen.findByLabelText('Price'), '0');
    await user.click(screen.getByRole('link', { name: 'My courses' }));

    expect(
      await screen.findByRole('heading', { name: 'My courses page' }),
    ).toBeVisible();
    expect(screen.queryByText('Leave without saving?')).toBeNull();
  });
});
