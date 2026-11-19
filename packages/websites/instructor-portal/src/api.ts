/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { createTrpcProvider } from '@discava/common-web-utils/trpc-provider';
import type { AppRouter as CoreAppRouter } from '@discava/core-api';
import type { AppRouter as InstructorAppRouter } from '@discava/instructor-api';
import type { TRPCClient } from '@trpc/client';
import type { TRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { Context, FC, PropsWithChildren } from 'react';

export interface CoreApiTRPCContextValue {
  optionsProxy: TRPCOptionsProxy<CoreAppRouter>;
  client: TRPCClient<CoreAppRouter>;
}

const coreApi = createTrpcProvider<CoreAppRouter>({ apiKey: 'CoreApi' });

export const CoreApiClientProvider: FC<PropsWithChildren> = coreApi.Provider;
export const CoreApiTRPCContext: Context<CoreApiTRPCContextValue | null> =
  coreApi.Context;
export const useCoreApi: () => CoreApiTRPCContextValue['optionsProxy'] =
  coreApi.useApi;
export const useCoreApiClient: () => CoreApiTRPCContextValue['client'] =
  coreApi.useApiClient;

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
