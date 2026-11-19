/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { createTrpcProvider } from '@discava/common-web-utils/trpc-provider';
import type { AppRouter } from '@discava/core-api';
import type { TRPCClient } from '@trpc/client';
import type { TRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { Context, FC, PropsWithChildren } from 'react';

export interface CoreApiTRPCContextValue {
  optionsProxy: TRPCOptionsProxy<AppRouter>;
  client: TRPCClient<AppRouter>;
}

const coreApi = createTrpcProvider<AppRouter>({
  apiKey: 'CoreApi',
  credentials: 'include',
});

export const CoreApiClientProvider: FC<PropsWithChildren> = coreApi.Provider;
export const CoreApiTRPCContext: Context<CoreApiTRPCContextValue | null> =
  coreApi.Context;
export const useCoreApi: () => CoreApiTRPCContextValue['optionsProxy'] =
  coreApi.useApi;
export const useCoreApiClient: () => CoreApiTRPCContextValue['client'] =
  coreApi.useApiClient;
