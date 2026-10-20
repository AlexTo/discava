/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppRouter } from '@discava/core-api';
import { useQueryClient } from '@tanstack/react-query';
import {
  createTRPCClient,
  httpLink,
  httpSubscriptionLink,
  splitLink,
  TRPCClient,
} from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { EventSourcePolyfill } from 'event-source-polyfill';
import { createContext, FC, PropsWithChildren, useMemo } from 'react';
import { useAuth } from 'react-oidc-context';
import { useRuntimeConfig } from '../hooks/useRuntimeConfig';

export interface CoreApiTRPCContextValue {
  optionsProxy: ReturnType<typeof createTRPCOptionsProxy<AppRouter>>;
  client: TRPCClient<AppRouter>;
}

export const CoreApiTRPCContext = createContext<CoreApiTRPCContextValue | null>(
  null,
);

export const CoreApiClientProvider: FC<PropsWithChildren> = ({ children }) => {
  const queryClient = useQueryClient();
  const runtimeConfig = useRuntimeConfig();
  const apiUrl = runtimeConfig.apis.CoreApi;
  const auth = useAuth();
  const user = auth?.user;

  const container = useMemo<CoreApiTRPCContextValue>(() => {
    const client = createTRPCClient<AppRouter>({
      links: [
        splitLink({
          condition: (op) => op.type === 'subscription',
          true: httpSubscriptionLink({
            url: apiUrl,
            EventSource: EventSourcePolyfill,
            eventSourceOptions: async ({ op }) => {
              return {
                headers: {
                  Authorization: `Bearer ${user?.access_token}`,
                },
              };
            },
          }),
          false: httpLink({
            url: apiUrl,
            headers: {
              Authorization: `Bearer ${user?.access_token}`,
            },
            // contentItem.videoUrl sets CloudFront signed cookies on the
            // API's parent domain for HLS playback; without `credentials:
            // 'include'` the browser ignores a cross-origin response's
            // Set-Cookie.
            fetch: (url, options) =>
              fetch(url, { ...options, credentials: 'include' }),
          }),
        }),
      ],
    });

    const optionsProxy = createTRPCOptionsProxy<AppRouter>({
      client,
      queryClient,
    });

    return { optionsProxy, client };
  }, [apiUrl, queryClient, user]);

  return (
    <CoreApiTRPCContext.Provider value={container}>
      {children}
    </CoreApiTRPCContext.Provider>
  );
};

export default CoreApiClientProvider;
