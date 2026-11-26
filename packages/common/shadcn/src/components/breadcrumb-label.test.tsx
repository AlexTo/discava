/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/here' }),
}));

import {
  BreadcrumbOverrideContext,
  useBreadcrumbLabel,
  useBreadcrumbOptions,
} from './breadcrumb-label';

const Probe = ({ href, hidden }: { href?: string; hidden?: boolean }) => {
  useBreadcrumbLabel('Label');
  useBreadcrumbOptions('/path', { href, hidden });
  return null;
};

const withContext = () => {
  const ctx = { setOverride: vi.fn(), setCrumbOptions: vi.fn() };
  const ui = (props: { href?: string; hidden?: boolean }) => (
    <BreadcrumbOverrideContext.Provider value={ctx}>
      <Probe {...props} />
    </BreadcrumbOverrideContext.Provider>
  );
  return { ctx, ui };
};

describe('useBreadcrumbOptions', () => {
  it('sets the options, follows a change and clears them on unmount', () => {
    const { ctx, ui } = withContext();
    const { rerender, unmount } = render(ui({ href: '/a' }));
    expect(ctx.setCrumbOptions).toHaveBeenLastCalledWith('/path', {
      href: '/a',
      hidden: undefined,
    });

    rerender(ui({ hidden: true }));
    expect(ctx.setCrumbOptions).toHaveBeenLastCalledWith('/path', {
      href: undefined,
      hidden: true,
    });

    unmount();
    expect(ctx.setCrumbOptions).toHaveBeenLastCalledWith('/path', undefined);
    expect(ctx.setOverride).toHaveBeenLastCalledWith('/here', undefined);
  });

  it('does nothing outside a portal shell', () => {
    expect(() => render(<Probe href="/a" />)).not.toThrow();
  });
});
