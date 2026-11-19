/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AppRouter } from '@discava/admin-api';
import { RuntimeConfigContext } from '@discava/common-web-utils/runtime-config';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type RenderResult, render } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { createTRPCClient, httpLink } from '@trpc/client';
import {
  createTRPCOptionsProxy,
  type TRPCOptionsProxy,
} from '@trpc/tanstack-react-query';
import type { ReactElement } from 'react';
import { AdminApiTRPCContext } from '../api';
import { type ApiCall, fakeFetch, type Handler } from './fake-trpc-fetch';

const API_URL = 'http://admin-api.test/';

// Re-exported for existing imports; shared with render-with-core-api, since
// both APIs fail the same way (TRPCError({ code, message })).
export { ApiError } from './fake-trpc-fetch';
export type { ApiCall, Handler };

// Renders `ui` inside a fresh React Query client and an admin API whose
// procedures are answered by `handlers` (keyed by path, e.g. 'category.list').
// Returns every call the component made, the query client, and a user-event
// instance for interacting with it.
// Spelled out so the declaration emit doesn't have to name the API router's
// inferred types.
export interface RenderedWithApi extends RenderResult {
  calls: ApiCall[];
  queryClient: QueryClient;
  optionsProxy: TRPCOptionsProxy<AppRouter>;
  user: UserEvent;
}

export const renderWithAdminApi = (
  ui: ReactElement,
  { handlers = {} }: { handlers?: Record<string, Handler> } = {},
): RenderedWithApi => {
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
    <RuntimeConfigContext.Provider value={{}}>
      <QueryClientProvider client={queryClient}>
        <AdminApiTRPCContext.Provider value={{ client, optionsProxy }}>
          {ui}
        </AdminApiTRPCContext.Provider>
      </QueryClientProvider>
    </RuntimeConfigContext.Provider>,
  );
  return { ...result, calls, queryClient, optionsProxy, user };
};
