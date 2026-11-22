/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { resolveBrand } from '@discava/common-branding/brand';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { routeTree } from '../../routeTree.gen';
import { renderWithCoreApi } from '../../test/render-with-core-api';

const handlers = {
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
};

describe('Marketing home brand name', () => {
  it('uses the brand name in the copy and the footer', async () => {
    renderWithCoreApi(null, {
      routeTree,
      path: '/',
      signedIn: false,
      handlers,
      brand: resolveBrand(
        {
          name: 'Acme Academy',
          showNameBesideLogo: true,
          colour: null,
          logoKey: null,
          iconKey: null,
          shareImageKey: null,
        },
        undefined,
      ),
    });

    expect(
      await screen.findByText(
        /certificates you can share\. Acme Academy brings your courses/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Acme Academy brings the important parts/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/© \d{4} Acme Academy\. Learning, made clearer\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Discava brings/)).not.toBeInTheDocument();
  });
});

describe('Marketing home footer', () => {
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
