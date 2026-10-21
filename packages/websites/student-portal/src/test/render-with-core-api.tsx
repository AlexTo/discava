/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
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
import { CoreApiTRPCContext } from '../components/CoreApiClientProvider';
import { RuntimeConfigContext } from '../components/RuntimeConfig';

const API_URL = 'http://core-api.test/';
// Where public media (course images) is served from in tests.
export const PUBLIC_MEDIA_URL = 'https://media.test/';

// What a handler throws to make a procedure fail, as the API would with
// TRPCError({ code, message }).
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const HTTP_STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  INTERNAL_SERVER_ERROR: 500,
};

// A procedure's stand-in: gets the input, returns the output or throws.
export type Handler = (input: unknown) => unknown;

export interface ApiCall {
  path: string;
  input: unknown;
}

// Answers the portal's real tRPC client the way the API does over HTTP (no
// batching, no transformer: GET ?input= for queries, a JSON body for
// mutations), so components run with their real hooks and client.
const fakeFetch =
  (handlers: Record<string, Handler>, calls: ApiCall[]) =>
  async (url: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const { pathname, searchParams } = new URL(String(url));
    const path = pathname.replace(/^\//, '');
    const rawInput =
      init?.method === 'POST' ? init.body : searchParams.get('input');
    const input =
      typeof rawInput === 'string' && rawInput
        ? JSON.parse(rawInput)
        : undefined;
    calls.push({ path, input });
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    const handler = handlers[path];
    if (!handler) {
      return json(
        {
          error: {
            message: `No handler for ${path}`,
            code: -32004,
            data: { code: 'NOT_FOUND', httpStatus: 404, path },
          },
        },
        404,
      );
    }
    try {
      return json({ result: { data: (await handler(input)) ?? null } });
    } catch (error) {
      const code =
        error instanceof ApiError ? error.code : 'INTERNAL_SERVER_ERROR';
      const httpStatus = HTTP_STATUS[code] ?? 500;
      return json(
        {
          error: {
            message: (error as Error).message,
            code: -32000,
            data: { code, httpStatus, path },
          },
        },
        httpStatus,
      );
    }
  };

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
// e.g. a spy for signinRedirect, and `cognito: true` makes routes that need
// sign-in check for it (without it they let everyone in, as in local dev).
export const renderWithCoreApi = (
  ui: ReactElement | null,
  {
    handlers = {},
    signedIn = true,
    auth = {},
    routeTree,
    path = '/',
    cognito = false,
  }: {
    handlers?: Record<string, Handler>;
    signedIn?: boolean;
    auth?: Partial<AuthContextProps>;
    routeTree?: AnyRoute;
    path?: string;
    cognito?: boolean;
  } = {},
) => {
  const calls: ApiCall[] = [];
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const client = createTRPCClient<AppRouter>({
    links: [httpLink({ url: API_URL, fetch: fakeFetch(handlers, calls) })],
  });
  const optionsProxy = createTRPCOptionsProxy<AppRouter>({
    client,
    queryClient,
  });
  const authContext = { ...authState(signedIn), ...auth };
  const router = createRouter({
    routeTree: routeTree ?? createRootRoute({ component: () => ui }),
    history: createMemoryHistory({ initialEntries: [path] }),
    // As main.tsx provides. requireSignIn only checks for sign-in when
    // Cognito is configured.
    context: {
      runtimeConfig: cognito ? { cognitoProps: {} } : undefined,
      auth: authContext,
    },
  });
  const user = userEvent.setup();
  const result = render(
    <RuntimeConfigContext.Provider
      value={{ media: { PublicMediaBucket: PUBLIC_MEDIA_URL } }}
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
