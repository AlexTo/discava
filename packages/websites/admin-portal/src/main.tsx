/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import CognitoAuth from '@discava/common-shadcn/components/cognito-auth';
import { LoadingState } from '@discava/common-shadcn/components/loading-state';
import { BrandProvider } from '@discava/common-web-utils/brand';
import QueryClientProvider from '@discava/common-web-utils/query-client';
import {
  RuntimeConfigProvider,
  useRuntimeConfig,
} from '@discava/common-web-utils/runtime-config';
import { RouterProvider } from '@tanstack/react-router';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { useAuth } from 'react-oidc-context';
import { AdminApiClientProvider, CoreApiClientProvider } from './api';
import { AdminBrandSync } from './components/admin-brand-sync';
import { LOCAL_DEV_CONFIG } from './local-dev-config';
import { router } from './router';
import './styles.css';

const App = () => {
  const auth = useAuth();
  const runtimeConfig = useRuntimeConfig();
  return (
    <>
      <AdminBrandSync />
      <RouterProvider router={router} context={{ runtimeConfig, auth }} />
    </>
  );
};

const root = document.getElementById('root');
root &&
  createRoot(root).render(
    <React.StrictMode>
      <RuntimeConfigProvider
        localDevConfig={LOCAL_DEV_CONFIG}
        fallback={<LoadingState size="page" label="Loading Discava…" />}
      >
        <BrandProvider
          fallback={<LoadingState size="page" label="Loading Discava…" />}
        >
          <CognitoAuth
            autoSignIn
            fallback={<LoadingState size="page" label="Signing you in…" />}
            // The router isn't created until signed in, so it starts on this page.
            onReturn={(path) => window.history.replaceState(null, '', path)}
          >
            <QueryClientProvider>
              <CoreApiClientProvider>
                <AdminApiClientProvider>
                  <App />
                </AdminApiClientProvider>
              </CoreApiClientProvider>
            </QueryClientProvider>
          </CognitoAuth>
        </BrandProvider>
      </RuntimeConfigProvider>
    </React.StrictMode>,
  );
