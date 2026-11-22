/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useLocation } from '@tanstack/react-router';
import { createContext, useContext, useEffect } from 'react';

// Lets a route override its own breadcrumb label once it has loaded data a
// path segment can't express on its own (e.g. a course id -> its title).
// Keyed by pathname so PortalShell can look an override up per-crumb.
export const BreadcrumbOverrideContext = createContext<{
  setOverride: (pathname: string, label: string | undefined) => void;
} | null>(null);

// `path` labels a crumb above the current page (a course, say), for pages
// that sit under it without rendering inside its layout. It defaults to the
// current pathname.
export function useBreadcrumbLabel(label: string | undefined, path?: string) {
  const ctx = useContext(BreadcrumbOverrideContext);
  const location = useLocation();
  const pathname = path ?? location.pathname;

  useEffect(() => {
    if (!ctx || !label) return;
    ctx.setOverride(pathname, label);
    return () => ctx.setOverride(pathname, undefined);
  }, [ctx, pathname, label]);
}
