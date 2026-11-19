/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AppRouter as AdminAppRouter } from '@discava/admin-api';
import {
  CoreApiTRPCContext,
  type CoreApiTRPCContextValue,
  useCoreApi,
  useCoreApiClient,
} from '@discava/common-shadcn/lib/core-api';
import { createTrpcProvider } from '@discava/common-web-utils/trpc-provider';
import type { AppRouter as CoreAppRouter } from '@discava/core-api';
import type { TRPCClient } from '@trpc/client';
import type { TRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { Context, FC, PropsWithChildren } from 'react';

const coreApi = createTrpcProvider<CoreAppRouter>({
  apiKey: 'CoreApi',
  context: CoreApiTRPCContext,
});

export const CoreApiClientProvider: FC<PropsWithChildren> = coreApi.Provider;
export {
  CoreApiTRPCContext,
  type CoreApiTRPCContextValue,
  useCoreApi,
  useCoreApiClient,
};

export interface AdminApiTRPCContextValue {
  optionsProxy: TRPCOptionsProxy<AdminAppRouter>;
  client: TRPCClient<AdminAppRouter>;
}

const adminApi = createTrpcProvider<AdminAppRouter>({ apiKey: 'AdminApi' });

export const AdminApiClientProvider: FC<PropsWithChildren> = adminApi.Provider;
export const AdminApiTRPCContext: Context<AdminApiTRPCContextValue | null> =
  adminApi.Context;
export const useAdminApi: () => AdminApiTRPCContextValue['optionsProxy'] =
  adminApi.useApi;
export const useAdminApiClient: () => AdminApiTRPCContextValue['client'] =
  adminApi.useApiClient;
