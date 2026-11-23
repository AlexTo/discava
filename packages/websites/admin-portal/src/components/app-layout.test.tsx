/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getBreadcrumbs } from '@discava/common-shadcn/components/portal-shell';
import { describe, expect, it } from 'vitest';
import { router } from '../router';
import { segmentLabels } from './app-layout';

// The routes the admin portal really has, as PortalShell checks them.
const adminPaths = new Set(Object.keys(router.routesByPath));
const routeExists = (href: string) => adminPaths.has(href);

const labels = (path: string) =>
  getBreadcrumbs(routeExists, path, 'Home', {}, segmentLabels).map(
    ({ text }) => text,
  );

describe('the admin breadcrumbs', () => {
  it.each([
    ['/categories', ['Home', 'Categories']],
    ['/reviews', ['Home', 'Reviews']],
    ['/certificates', ['Home', 'Certificates']],
    ['/payments', ['Home', 'Payments']],
    ['/settings/notifications', ['Home', 'Settings', 'Notification settings']],
    ['/settings/branding', ['Home', 'Settings', 'Branding']],
  ])('label %s', (path, expected) => {
    expect(labels(path)).toEqual(expected);
  });
});

describe('the admin breadcrumb links', () => {
  it.each(['/settings/branding', '/settings/notifications'])(
    'show Settings as text, not a link, on %s',
    (path) => {
      const crumbs = getBreadcrumbs(
        routeExists,
        path,
        'Home',
        {},
        segmentLabels,
      );
      expect(crumbs.map(({ href }) => href)).toEqual(['/', undefined, path]);
    },
  );

  it.each([
    '/categories',
    '/reviews',
    '/certificates',
    '/payments',
    '/settings/branding',
    '/settings/notifications',
  ])('only link to admin routes on %s', (path) => {
    for (const { href } of getBreadcrumbs(
      routeExists,
      path,
      'Home',
      {},
      segmentLabels,
    )) {
      if (href) expect(adminPaths.has(href)).toBe(true);
    }
  });
});
