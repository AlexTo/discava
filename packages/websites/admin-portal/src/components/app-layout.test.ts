/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getBreadcrumbs } from '@discava/common-shadcn/components/portal-shell';
import { describe, expect, it } from 'vitest';
import { segmentLabels } from './app-layout';

const matchAll = () => true;

const labels = (path: string) =>
  getBreadcrumbs(matchAll, path, 'Home', {}, segmentLabels).map(
    ({ text }) => text,
  );

describe('the admin breadcrumbs', () => {
  it.each([
    ['/categories', ['Home', 'Categories']],
    ['/reviews', ['Home', 'Reviews']],
    ['/certificates', ['Home', 'Certificates']],
    ['/payments', ['Home', 'Payments']],
    ['/settings/notifications', ['Home', 'Settings', 'Notifications']],
    ['/settings/branding', ['Home', 'Settings', 'Branding']],
  ])('label %s', (path, expected) => {
    expect(labels(path)).toEqual(expected);
  });
});
