/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { RuntimeConfigContext } from '@discava/common-web-utils/runtime-config';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auth } = vi.hoisted(() => ({
  auth: { user: undefined as unknown },
}));
vi.mock('react-oidc-context', () => ({ useAuth: () => auth }));
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { usePageTitle } = await import(
    '@discava/common-shadcn/hooks/use-page-title'
  );
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, {
    Outlet: () => {
      usePageTitle('Payments');
      return <p>the page</p>;
    },
  });
});
vi.mock('../components/app-layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../components/admin-brand-sync', () => ({
  AdminBrandSync: () => <p>brand sync</p>,
}));

import { NotFoundPage } from '../components/not-found-page';
import { Route } from './__root';

const AdminsOnly = Route.options.component!;

const renderAs = (groups: string[]) => {
  auth.user = { profile: { given_name: 'Sam', 'cognito:groups': groups } };
  render(
    <RuntimeConfigContext.Provider value={{ portals: {} }}>
      <AdminsOnly />
    </RuntimeConfigContext.Provider>,
  );
};

beforeEach(() => {
  auth.user = undefined;
});

describe('the admin portal guard, which every route (the Branding page too) sits behind', () => {
  it('shows the not-found page for an address with no route', () => {
    expect(Route.options.notFoundComponent).toBe(NotFoundPage);
  });

  it('lets an administrator in', () => {
    renderAs(['admin']);
    expect(screen.getByText('the page')).toBeInTheDocument();
  });

  it('syncs the saved brand for an administrator', () => {
    renderAs(['admin']);
    expect(screen.getByText('brand sync')).toBeInTheDocument();
  });

  it.each([['student'], ['instructor']])(
    'mounts no brand sync, so makes no branding.get call, for a %s',
    (group) => {
      renderAs([group]);
      expect(screen.queryByText('brand sync')).not.toBeInTheDocument();
    },
  );

  it.each([['student'], ['instructor']])(
    'keeps a %s out, whatever the address',
    (group) => {
      renderAs([group]);
      expect(screen.queryByText('the page')).not.toBeInTheDocument();
      expect(
        screen.getByText('The admin portal is for administrators'),
      ).toBeInTheDocument();
    },
  );

  it("keeps an administrator's page title after first load", () => {
    renderAs(['admin']);
    expect(document.title).toBe('Payments · Discava');
  });

  it('titles the restricted page for a non-administrator', () => {
    renderAs(['student']);
    expect(document.title).toBe('Administrators only · Discava');
  });
});
