/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import CognitoAuth from '@discava/common-shadcn/components/cognito-auth';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import QueryClientProvider from '@discava/common-web-utils/query-client';
import { retryQuery } from '@discava/common-web-utils/query-retry';
import {
  RuntimeConfigProvider,
  useRuntimeConfig,
} from '@discava/common-web-utils/runtime-config';
import type { AppRouter } from '@discava/core-api';
import { QueryClient } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { useAuth } from 'react-oidc-context';
import { CoreApiClientProvider } from './api';
import { seedFromPageData } from './lib/page-data';
import { LOCAL_DEV_CONFIG } from './local-dev-config';
import { router } from './router';
import './styles.css';

const App = () => {
  const auth = useAuth();
  const runtimeConfig = useRuntimeConfig();
  return <RouterProvider router={router} context={{ runtimeConfig, auth }} />;
};

// A landing page or profile from the page renderer arrives with its data in
// the HTML: put it in the cache before the first render. Query keys don't
// depend on the client, so this proxy's is never called.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: retryQuery } },
});
seedFromPageData(
  queryClient,
  createTRPCOptionsProxy<AppRouter>({
    client: createTRPCClient<AppRouter>({
      links: [httpLink({ url: 'http://localhost/' })],
    }),
    queryClient,
  }),
);

const root = document.getElementById('root');
root &&
  createRoot(root).render(
    <React.StrictMode>
      <RuntimeConfigProvider
        localDevConfig={LOCAL_DEV_CONFIG}
        fallback={<Spinner />}
      >
        <CognitoAuth
          // Runs above <RouterProvider>, so useNavigate isn't available here:
          // navigate via the router instance directly.
          onReturn={(path) => router.navigate({ href: path, replace: true })}
        >
          <QueryClientProvider client={queryClient}>
            <CoreApiClientProvider>
              <App />
            </CoreApiClientProvider>
          </QueryClientProvider>
        </CognitoAuth>
      </RuntimeConfigProvider>
    </React.StrictMode>,
  );
