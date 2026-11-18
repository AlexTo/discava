/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppRouter } from '@discava/admin-api';
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

export interface AdminApiTRPCContextValue {
  optionsProxy: ReturnType<typeof createTRPCOptionsProxy<AppRouter>>;
  client: TRPCClient<AppRouter>;
}

export const AdminApiTRPCContext =
  createContext<AdminApiTRPCContextValue | null>(null);

export const AdminApiClientProvider: FC<PropsWithChildren> = ({ children }) => {
  const queryClient = useQueryClient();
  const runtimeConfig = useRuntimeConfig();
  const apiUrl = runtimeConfig.apis.AdminApi;
  const auth = useAuth();
  const user = auth?.user;

  const container = useMemo<AdminApiTRPCContextValue>(() => {
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
    <AdminApiTRPCContext.Provider value={container}>
      {children}
    </AdminApiTRPCContext.Provider>
  );
};

export default AdminApiClientProvider;
