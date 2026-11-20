/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { RuntimeConfigContext } from '@discava/common-web-utils/runtime-config';
import {
  type ApiCall,
  fakeTrpcFetch,
  type Handler,
} from '@discava/common-web-utils/testing';
import type { AppRouter } from '@discava/core-api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type AnyRoute,
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { ReactElement } from 'react';
import { AuthContext, type AuthContextProps } from 'react-oidc-context';
import { CoreApiTRPCContext } from '../api';

const API_URL = 'http://core-api.test/';
// Where public media (course images) is served from in tests.
export const PUBLIC_MEDIA_URL = 'https://media.test/';

// Re-exported so tests need a single import from this file.
export {
  type ApiCall,
  ApiError,
  type Handler,
} from '@discava/common-web-utils/testing';

// The signed-in state useAuth() reports: a student with this `sub`, or no one.
const authState = (signedIn: boolean): AuthContextProps =>
  ({
    isLoading: false,
    isAuthenticated: signedIn,
    user: signedIn
      ? { access_token: 'test-token', profile: { sub: 'student-1' } }
      : null,
    signinRedirect: async () => {},
    signoutRedirect: async () => {},
  }) as unknown as AuthContextProps;

// Renders `ui` as the only route of a router at `/` (so <Link>s work and
// their hrefs can be checked), inside a fresh React Query client, the
// signed-in state `signedIn` asks for, and a core-api whose procedures are
// answered by `handlers` (keyed by path, e.g. 'course.enrol'). Returns every
// call the component made, the query client, the router and a user-event
// instance. The router renders asynchronously, so look elements up with
// findBy*.
//
// To test routes themselves, pass the app's `routeTree` and the `path` to
// start at instead of `ui`; `auth` overrides parts of the signed-in state,
// e.g. a spy for signinRedirect.
export const renderWithCoreApi = (
  ui: ReactElement | null,
  {
    handlers = {},
    signedIn = true,
    auth = {},
    routeTree,
    path = '/',
    runtimeConfig = {},
    queryClient: sharedQueryClient,
  }: {
    handlers?: Record<string, Handler>;
    signedIn?: boolean;
    auth?: Partial<AuthContextProps>;
    routeTree?: AnyRoute;
    path?: string;
    // Merged into the runtime config the portal sees.
    runtimeConfig?: Record<string, unknown>;
    // Reuse another render's cache, as navigating back within one session does.
    queryClient?: QueryClient;
  } = {},
) => {
  const calls: ApiCall[] = [];
  const queryClient =
    sharedQueryClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  const client = createTRPCClient<AppRouter>({
    links: [httpLink({ url: API_URL, fetch: fakeTrpcFetch(handlers, calls) })],
  });
  const optionsProxy = createTRPCOptionsProxy<AppRouter>({
    client,
    queryClient,
  });
  const authContext = { ...authState(signedIn), ...auth };
  const router = createRouter({
    routeTree: routeTree ?? createRootRoute({ component: () => ui }),
    history: createMemoryHistory({ initialEntries: [path] }),
    // As main.tsx provides.
    context: { runtimeConfig: undefined, auth: authContext },
  });
  const user = userEvent.setup();
  const result = render(
    <RuntimeConfigContext.Provider
      value={{
        media: { PublicMediaBucket: PUBLIC_MEDIA_URL },
        site: { name: 'Discava' },
        ...runtimeConfig,
      }}
    >
      <AuthContext.Provider value={authContext}>
        <QueryClientProvider client={queryClient}>
          <CoreApiTRPCContext.Provider value={{ client, optionsProxy }}>
            <RouterProvider router={router} />
          </CoreApiTRPCContext.Provider>
        </QueryClientProvider>
      </AuthContext.Provider>
    </RuntimeConfigContext.Provider>,
  );
  return { ...result, calls, queryClient, optionsProxy, router, user };
};
