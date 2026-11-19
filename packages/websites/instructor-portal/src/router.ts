/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

// Exported so code outside the React tree (e.g. CognitoAuth's
// onSigninCallback, which runs above <RouterProvider> and can't use the
// useNavigate hook) can still navigate via router.navigate(...).
export const router = createRouter({
  routeTree,
  context: { runtimeConfig: undefined, auth: undefined },
});

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
