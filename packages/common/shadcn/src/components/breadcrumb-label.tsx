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
  setCrumbOptions: (
    pathname: string,
    options: CrumbOptions | undefined,
  ) => void;
} | null>(null);

// How a crumb is shown, beyond its label: `href` links it somewhere other than
// its own path (which may have no page), `hidden` drops it from the trail.
export interface CrumbOptions {
  href?: string;
  hidden?: boolean;
}

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

// Changes how the crumb at `path` links or whether it shows, for a page whose
// trail skips a level (an assignment crumb that opens its submissions list in
// place of a separate "Submissions" crumb). Pass a stable `options`, or one
// whose fields are primitives.
export function useBreadcrumbOptions(path: string, options: CrumbOptions) {
  const ctx = useContext(BreadcrumbOverrideContext);
  const { href, hidden } = options;

  useEffect(() => {
    if (!ctx) return;
    ctx.setCrumbOptions(path, { href, hidden });
    return () => ctx.setCrumbOptions(path, undefined);
  }, [ctx, path, href, hidden]);
}
