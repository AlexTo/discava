/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRouter, RouterProvider } from '@tanstack/react-router';
import React from 'react';
import { createRoot } from 'react-dom/client';
/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useAuth } from 'react-oidc-context';
import AdminApiClientProvider from './components/AdminApiClientProvider';
import CognitoAuth from './components/CognitoAuth';
import CoreApiClientProvider from './components/CoreApiClientProvider';
import QueryClientProvider from './components/QueryClientProvider';
import RuntimeConfigProvider from './components/RuntimeConfig';
import { useRuntimeConfig } from './hooks/useRuntimeConfig';
import { routeTree } from './routeTree.gen';
import './styles.css';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type RouterProviderContext = {
  runtimeConfig?: ReturnType<typeof useRuntimeConfig>;
  auth?: ReturnType<typeof useAuth>;
};

const router = createRouter({
  routeTree,
  context: { runtimeConfig: undefined, auth: undefined },
});

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const App = () => {
  const auth = useAuth();
  const runtimeConfig = useRuntimeConfig();
  return <RouterProvider router={router} context={{ runtimeConfig, auth }} />;
};

const root = document.getElementById('root');
root &&
  createRoot(root).render(
    <React.StrictMode>
      <RuntimeConfigProvider>
        <CognitoAuth>
          <QueryClientProvider>
            <CoreApiClientProvider>
              <AdminApiClientProvider>
                <App />
              </AdminApiClientProvider>
            </CoreApiClientProvider>
          </QueryClientProvider>
        </CognitoAuth>
      </RuntimeConfigProvider>
    </React.StrictMode>,
  );
