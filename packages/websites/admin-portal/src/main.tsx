/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import QueryClientProvider from '@discava/common-web-utils/query-client';
import {
  RuntimeConfigProvider,
  useRuntimeConfig,
} from '@discava/common-web-utils/runtime-config';
import { RouterProvider } from '@tanstack/react-router';
import React from 'react';
import { createRoot } from 'react-dom/client';
/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useAuth } from 'react-oidc-context';
import { AdminApiClientProvider, CoreApiClientProvider } from './api';
import CognitoAuth from './components/CognitoAuth';
import { LOCAL_DEV_CONFIG } from './local-dev-config';
import { router } from './router';
import './styles.css';

const App = () => {
  const auth = useAuth();
  const runtimeConfig = useRuntimeConfig();
  return <RouterProvider router={router} context={{ runtimeConfig, auth }} />;
};

const root = document.getElementById('root');
root &&
  createRoot(root).render(
    <React.StrictMode>
      <RuntimeConfigProvider
        localDevConfig={LOCAL_DEV_CONFIG}
        fallback={<Spinner />}
      >
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
