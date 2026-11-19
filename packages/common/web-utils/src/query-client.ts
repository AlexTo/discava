/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  QueryClient,
  QueryClientProvider as QueryClientProviderInner,
} from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import {
  type ComponentProps,
  createElement,
  type FC,
  type PropsWithChildren,
  useState,
} from 'react';
import { retryQuery } from './query-retry';

type QueryClientProviderProps = PropsWithChildren & {
  client?: QueryClient;
  devtoolsOptions?: Omit<ComponentProps<typeof ReactQueryDevtools>, 'client'>;
  disableDevtools?: boolean;
};

export const QueryClientProvider: FC<QueryClientProviderProps> = ({
  children,
  // Answers that won't change, like not found or forbidden, show at once
  // rather than after three retries (#236).
  client = new QueryClient({
    defaultOptions: { queries: { retry: retryQuery } },
  }),
  disableDevtools = false,
  devtoolsOptions,
}) => {
  const [queryClient] = useState(client);
  return createElement(
    QueryClientProviderInner,
    { client: queryClient },
    children,
    !disableDevtools &&
      createElement(ReactQueryDevtools, {
        client: queryClient,
        ...devtoolsOptions,
      }),
  );
};

export default QueryClientProvider;
