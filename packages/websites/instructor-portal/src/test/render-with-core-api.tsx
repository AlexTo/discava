/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AppRouter } from '@discava/core-api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { ReactElement } from 'react';
import { CoreApiTRPCContext } from '../components/CoreApiClientProvider';
import { RuntimeConfigContext } from '../components/RuntimeConfig';
import { type ApiCall, fakeFetch, type Handler } from './fake-trpc-fetch';

const API_URL = 'http://core-api.test/';
export const PUBLIC_MEDIA_URL = 'https://media.test/';

// Re-exported so tests don't need a second import from fake-trpc-fetch.
export { ApiError } from './fake-trpc-fetch';
export type { ApiCall, Handler };

// Renders `ui` inside a fresh React Query client and a core API whose
// procedures are answered by `handlers` (keyed by path, e.g.
// 'course.publicList'). See renderWithInstructorApi for the shape of what's
// returned; this is its core-api counterpart, for the pages of the
// instructor and student portals that read from core-api instead.
export const renderWithCoreApi = (
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
        <CoreApiTRPCContext.Provider value={{ client, optionsProxy }}>
          {ui}
        </CoreApiTRPCContext.Provider>
      </QueryClientProvider>
    </RuntimeConfigContext.Provider>,
  );
  return { ...result, calls, queryClient, optionsProxy, user };
};
