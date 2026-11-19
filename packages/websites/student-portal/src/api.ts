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
import type { FC, PropsWithChildren } from 'react';

const coreApi = createTrpcProvider<CoreAppRouter>({
  apiKey: 'CoreApi',
  credentials: 'include',
  context: CoreApiTRPCContext,
});

export const CoreApiClientProvider: FC<PropsWithChildren> = coreApi.Provider;
export {
  CoreApiTRPCContext,
  type CoreApiTRPCContextValue,
  useCoreApi,
  useCoreApiClient,
};
