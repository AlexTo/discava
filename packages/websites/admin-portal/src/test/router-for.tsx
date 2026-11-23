/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { ComponentType } from 'react';

// A router holding one admin route, with its own search validation, started
// at `entry`. Render it with <RouterProvider router={...} />.
export const routerFor = (
  path: string,
  route: {
    component: ComponentType;
    validateSearch: (
      search: Record<string, unknown>,
    ) => Record<string, unknown>;
  },
  entry: string,
) => {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path,
    validateSearch: route.validateSearch,
    component: route.component as never,
  });
  return createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
};
