/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getBreadcrumbs } from '@discava/common-shadcn/components/portal-shell';
import { describe, expect, it } from 'vitest';
import { segmentLabels } from './app-layout';

const matchAll = (() => true) as unknown as Parameters<
  typeof getBreadcrumbs
>[0];

const labels = (path: string) =>
  getBreadcrumbs(matchAll, path, '/', {}, segmentLabels).map(
    ({ text }) => text,
  );

describe('the admin breadcrumbs', () => {
  it.each([
    ['/categories', ['/', 'Categories']],
    ['/reviews', ['/', 'Reviews']],
    ['/payments', ['/', 'Payments']],
    ['/settings/notifications', ['/', 'Settings', 'Notifications']],
  ])('label %s', (path, expected) => {
    expect(labels(path)).toEqual(expected);
  });
});
