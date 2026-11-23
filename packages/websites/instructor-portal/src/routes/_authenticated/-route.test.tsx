/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { resolveBrand } from '@discava/common-branding/brand';
import { BrandContextProvider } from '@discava/common-web-utils/brand';
import { RuntimeConfigContext } from '@discava/common-web-utils/runtime-config';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { profile: { sub: 'u1', name: 'Sam' } } }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, {});
});

const { Route } = await import('./route');
const InstructorsOnly = Route.options.component!;

describe('the restricted instructor portal page', () => {
  it('names the platform by its brand name', () => {
    const brand = resolveBrand(
      {
        name: 'Acme Academy',
        showNameBesideLogo: true,
        colour: null,
        logoKey: null,
        iconKey: null,
        shareImageKey: null,
      },
      undefined,
    );
    render(
      <RuntimeConfigContext.Provider value={{} as never}>
        <BrandContextProvider value={brand}>
          <InstructorsOnly />
        </BrandContextProvider>
      </RuntimeConfigContext.Provider>,
    );
    expect(
      screen.getByText(/To learn on Acme Academy, use/),
    ).toBeInTheDocument();
  });

  it('sets the page title', () => {
    render(
      <RuntimeConfigContext.Provider value={{} as never}>
        <InstructorsOnly />
      </RuntimeConfigContext.Provider>,
    );
    expect(document.title).toBe('Instructors only · Discava');
  });
});
