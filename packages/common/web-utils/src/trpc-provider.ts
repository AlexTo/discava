/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useQueryClient } from '@tanstack/react-query';
import {
  createTRPCClient,
  httpLink,
  httpSubscriptionLink,
  splitLink,
  type TRPCClient,
} from '@trpc/client';
import type { AnyTRPCRouter } from '@trpc/server';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { EventSourcePolyfill } from 'event-source-polyfill';
import {
  type Context,
  createContext,
  createElement,
  type FC,
  type PropsWithChildren,
  useContext,
  useMemo,
} from 'react';
import { useAuth } from 'react-oidc-context';
import { useRuntimeConfig } from './runtime-config';

export interface TrpcContextValue<TRouter extends AnyTRPCRouter> {
  optionsProxy: ReturnType<typeof createTRPCOptionsProxy<TRouter>>;
  client: TRPCClient<TRouter>;
}

export interface TrpcProviderOptions<TRouter extends AnyTRPCRouter> {
  /** The API's key under `apis` in the runtime config, e.g. 'CoreApi'. */
  apiKey: string;
  /**
   * Sent with every request when set. 'include' lets the browser keep the
   * Set-Cookie a cross-origin response carries (CloudFront signed cookies for
   * HLS playback, from `contentItem.videoUrl` and the instructor API's
   * `createVideoUrl`); without it the browser ignores them.
   */
  credentials?: RequestCredentials;
  /**
   * The context to provide and read, for an API whose hooks a shared component
   * calls: the component and the portal's provider must use the same one.
   * Without it, a new context is made.
   */
  context?: Context<TrpcContextValue<TRouter> | null>;
}

export interface TrpcProvider<TRouter extends AnyTRPCRouter> {
  Provider: FC<PropsWithChildren>;
  Context: Context<TrpcContextValue<TRouter> | null>;
  /** The API's TanStack Query options proxy. */
  useApi: () => TrpcContextValue<TRouter>['optionsProxy'];
  /** The API's tRPC client, for calls outside TanStack Query. */
  useApiClient: () => TrpcContextValue<TRouter>['client'];
}

/**
 * Builds the provider, context and hooks for one API: a tRPC client for the
 * URL under `apiKey` in the runtime config, authorized as the signed-in
 * user. The router type is a generic so this package never imports an API.
 */
export const createTrpcProvider = <TRouter extends AnyTRPCRouter>({
  apiKey,
  credentials,
  context,
}: TrpcProviderOptions<TRouter>): TrpcProvider<TRouter> => {
  const TrpcContext =
    context ?? createContext<TrpcContextValue<TRouter> | null>(null);

  const Provider: FC<PropsWithChildren> = ({ children }) => {
    const queryClient = useQueryClient();
    const runtimeConfig = useRuntimeConfig();
    const apiUrl = runtimeConfig.apis[apiKey];
    const auth = useAuth();
    const user = auth?.user;

    const container = useMemo<TrpcContextValue<TRouter>>(() => {
      // The links are built for any router: with a generic one, tRPC can't tell
      // whether the router needs a transformer, so the client is cast back.
      const client = createTRPCClient<AnyTRPCRouter>({
        links: [
          splitLink({
            condition: (op) => op.type === 'subscription',
            true: httpSubscriptionLink({
              url: apiUrl,
              EventSource: EventSourcePolyfill,
              eventSourceOptions: async () => {
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
              ...(credentials && {
                fetch: (url: URL | RequestInfo, options?: RequestInit) =>
                  fetch(url, { ...options, credentials }),
              }),
            }),
          }),
        ],
      }) as unknown as TRPCClient<TRouter>;

      const optionsProxy = createTRPCOptionsProxy<TRouter>({
        client,
        queryClient,
      });

      return { optionsProxy, client };
    }, [apiUrl, queryClient, user]);

    return createElement(TrpcContext.Provider, { value: container }, children);
  };

  const useApi = () => {
    const container = useContext(TrpcContext);
    if (!container) {
      throw new Error(
        `use${apiKey} must be used within ${apiKey}ClientProvider`,
      );
    }
    return container.optionsProxy;
  };

  const useApiClient = () => {
    const container = useContext(TrpcContext);
    if (!container) {
      throw new Error(
        `use${apiKey}Client must be used within ${apiKey}ClientProvider`,
      );
    }
    return container.client;
  };

  return { Provider, Context: TrpcContext, useApi, useApiClient };
};
