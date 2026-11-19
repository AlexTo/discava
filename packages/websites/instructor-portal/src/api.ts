/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CoreApiTRPCContext,
  type CoreApiTRPCContextValue,
  useCoreApi,
  useCoreApiClient,
} from '@discava/common-shadcn/lib/core-api';
import { createTrpcProvider } from '@discava/common-web-utils/trpc-provider';
import type { AppRouter as CoreAppRouter } from '@discava/core-api';
import type { AppRouter as InstructorAppRouter } from '@discava/instructor-api';
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

export interface InstructorApiTRPCContextValue {
  optionsProxy: TRPCOptionsProxy<InstructorAppRouter>;
  client: TRPCClient<InstructorAppRouter>;
}

const instructorApi = createTrpcProvider<InstructorAppRouter>({
  apiKey: 'InstructorApi',
  credentials: 'include',
});

export const InstructorApiClientProvider: FC<PropsWithChildren> =
  instructorApi.Provider;
export const InstructorApiTRPCContext: Context<InstructorApiTRPCContextValue | null> =
  instructorApi.Context;
export const useInstructorApi: () => InstructorApiTRPCContextValue['optionsProxy'] =
  instructorApi.useApi;
export const useInstructorApiClient: () => InstructorApiTRPCContextValue['client'] =
  instructorApi.useApiClient;
