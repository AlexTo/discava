/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useLocation } from '@tanstack/react-router';
import { createContext, useContext, useEffect } from 'react';

// Lets a route override its own breadcrumb label once it has loaded data a
// path segment can't express on its own (e.g. a course id -> its title).
// Keyed by pathname so AppLayout can look an override up per-crumb.
export const BreadcrumbOverrideContext = createContext<{
  setOverride: (pathname: string, label: string | undefined) => void;
} | null>(null);

export function useBreadcrumbLabel(label: string | undefined) {
  const ctx = useContext(BreadcrumbOverrideContext);
  const { pathname } = useLocation();

  useEffect(() => {
    if (!ctx || !label) return;
    ctx.setOverride(pathname, label);
    return () => ctx.setOverride(pathname, undefined);
  }, [ctx, pathname, label]);
}
