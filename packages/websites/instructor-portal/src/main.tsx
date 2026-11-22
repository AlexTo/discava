/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import CognitoAuth from '@discava/common-shadcn/components/cognito-auth';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
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
import { CoreApiClientProvider, InstructorApiClientProvider } from './api';
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
        <BrandProvider fallback={<Spinner />}>
          <CognitoAuth
            // Runs above <RouterProvider>, so useNavigate isn't available: the
            // router instance navigates without a full page reload.
            onReturn={(path) => router.navigate({ href: path, replace: true })}
          >
            <QueryClientProvider>
              <InstructorApiClientProvider>
                <CoreApiClientProvider>
                  <App />
                </CoreApiClientProvider>
              </InstructorApiClientProvider>
            </QueryClientProvider>
          </CognitoAuth>
        </BrandProvider>
      </RuntimeConfigProvider>
    </React.StrictMode>,
  );
