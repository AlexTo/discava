/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AppRouter } from '@discava/instructor-api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { ReactElement } from 'react';
import { InstructorApiTRPCContext } from '../components/InstructorApiClientProvider';
import { RuntimeConfigContext } from '../components/RuntimeConfig';

const API_URL = 'http://instructor-api.test/';
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

// Renders `ui` inside a fresh React Query client and an instructor API whose
// procedures are answered by `handlers` (keyed by path, e.g. 'course.publish').
// Returns every call the component made, the query client, and a user-event
// instance for interacting with it.
export const renderWithInstructorApi = (
  ui: ReactElement,
  { handlers = {} }: { handlers?: Record<string, Handler> } = {},
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
  const user = userEvent.setup();
  const result = render(
    <RuntimeConfigContext.Provider
      value={{ media: { PublicMediaBucket: PUBLIC_MEDIA_URL } }}
    >
      <QueryClientProvider client={queryClient}>
        <InstructorApiTRPCContext.Provider value={{ client, optionsProxy }}>
          {ui}
        </InstructorApiTRPCContext.Provider>
      </QueryClientProvider>
    </RuntimeConfigContext.Provider>,
  );
  return { ...result, calls, queryClient, optionsProxy, user };
};
