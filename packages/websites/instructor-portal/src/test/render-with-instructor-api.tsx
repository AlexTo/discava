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
import { type ApiCall, fakeFetch, type Handler } from './fake-trpc-fetch';

const API_URL = 'http://instructor-api.test/';
// Where public media (course images) is served from in tests.
export const PUBLIC_MEDIA_URL = 'https://media.test/';

// Re-exported for existing imports; shared with render-with-core-api, since
// both APIs fail the same way (TRPCError({ code, message })).
export { ApiError } from './fake-trpc-fetch';
export type { ApiCall, Handler };

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
