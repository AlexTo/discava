/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createRouter } from '@tanstack/react-router';
import { RootNotFound } from './components/not-found';
import { routeTree } from './routeTree.gen';

// Exported so code outside the router (e.g. CognitoAuth's onReturn, which runs
// above <RouterProvider> and can't use useNavigate) can navigate with it.
export const router = createRouter({
  routeTree,
  defaultNotFoundComponent: RootNotFound,
  context: { runtimeConfig: undefined, auth: undefined },
});

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
