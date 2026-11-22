/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createRouter } from '@tanstack/react-router';
import { NotFoundPage } from './components/not-found-page';
import { routeTree } from './routeTree.gen';

export const router = createRouter({
  routeTree,
  defaultNotFoundComponent: NotFoundPage,
  context: { runtimeConfig: undefined, auth: undefined },
});

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
