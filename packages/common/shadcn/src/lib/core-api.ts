/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTrpcProvider } from '@discava/common-web-utils/trpc-provider';
import type { AppRouter } from '@discava/core-api';
import type { TRPCClient } from '@trpc/client';
import type { TRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { Context } from 'react';

export interface CoreApiTRPCContextValue {
  optionsProxy: TRPCOptionsProxy<AppRouter>;
  client: TRPCClient<AppRouter>;
}

// The core API's context and hooks, once for the portals and the shared
// components that call core-api (the notification bell). Each portal builds
// its provider over this context in its own api.ts, so it keeps its own
// request credentials.
const coreApi = createTrpcProvider<AppRouter>({ apiKey: 'CoreApi' });

export const CoreApiTRPCContext: Context<CoreApiTRPCContextValue | null> =
  coreApi.Context;
export const useCoreApi: () => CoreApiTRPCContextValue['optionsProxy'] =
  coreApi.useApi;
export const useCoreApiClient: () => CoreApiTRPCContextValue['client'] =
  coreApi.useApiClient;
