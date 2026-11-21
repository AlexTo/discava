/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { routeTree } from '../../routeTree.gen';
import { renderWithCoreApi } from '../../test/render-with-core-api';

describe('Catalogue footer', () => {
  it('has no dead Terms link, and About stays on the home page', async () => {
    renderWithCoreApi(null, {
      routeTree,
      path: '/',
      signedIn: false,
      handlers: {
        'category.list': () => [],
        'course.publicList': () => ({ items: [] }),
        'course.publicSearch': () => ({
          items: [],
          cursor: null,
          facets: {
            categories: [],
            tags: [],
            levels: [],
            languages: [],
            durationBands: [],
          },
        }),
      },
    });

    const footer = within(
      await screen.findByRole('navigation', { name: 'Footer navigation' }),
    );
    expect(footer.queryByRole('link', { name: 'Terms' })).toBeNull();
    expect(footer.getByRole('link', { name: 'About' })).toHaveAttribute(
      'href',
      '/#features',
    );
  });
});
