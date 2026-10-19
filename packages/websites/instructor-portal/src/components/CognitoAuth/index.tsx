/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { safeReturnTo } from '@discava/common-shadcn/lib/return-to';
import React, { PropsWithChildren } from 'react';
import { AuthProvider, AuthProviderProps, useAuth } from 'react-oidc-context';
import { useRuntimeConfig } from '../../hooks/useRuntimeConfig';
import { router } from '../../router';
import { Alert } from '../alert';
import { Spinner } from '../spinner';

/**
 * Sets up the Cognito auth.
 *
 * This assumes a runtime-config.json file is present at '/'. In order for Auth to be set up automatically,
 * the runtime-config.json must have the cognitoProps set.
 */
const CognitoAuth: React.FC<PropsWithChildren> = ({ children }) => {
  const { cognitoProps } = useRuntimeConfig();

  if (!cognitoProps) {
    if (import.meta.env.MODE === 'local-dev') {
      // In local-dev mode with no cognitoProps available, we skip login
      return <AuthProvider>{children}</AuthProvider>;
    }
    return (
      <Alert type="error" header="Runtime config configuration error">
        <p>
          The cognitoProps have not been configured in the runtime-config.json.
        </p>
      </Alert>
    );
  }

  const cognitoAuthConfig: AuthProviderProps = {
    authority: `https://cognito-idp.${cognitoProps.region}.amazonaws.com/${cognitoProps.userPoolId}`,
    client_id: cognitoProps.userPoolWebClientId,
    redirect_uri: window.location.origin,
    response_type: 'code',
    scope: 'email openid profile',
    // Back to the page sign-in started from (the OIDC state signin.tsx
    // sends), or home. Also clears the code from the URL.
    onSigninCallback: (user) => {
      const returnTo = safeReturnTo(
        (user as { state?: { returnTo?: unknown } } | void)?.state?.returnTo,
      );
      // Runs above <RouterProvider> (see main.tsx), so useNavigate isn't
      // available here — navigate via the router instance directly instead
      // of window.location.replace, to avoid a full page reload.
      if (returnTo) {
        router.navigate({ href: returnTo, replace: true });
      } else {
        router.navigate({ to: '/', replace: true });
      }
    },
  };

  return (
    <AuthProvider {...cognitoAuthConfig}>
      <CognitoAuthInternal>{children}</CognitoAuthInternal>
    </AuthProvider>
  );
};

const CognitoAuthInternal: React.FC<PropsWithChildren> = ({ children }) => {
  const auth = useAuth();

  if (auth.error) {
    return (
      <Alert type="error" header="Configuration error">
        <p>
          Error contacting Cognito. Please check your runtime-config.json is
          configured with the correct endpoints.
        </p>
      </Alert>
    );
  }

  if (auth.isLoading) {
    return <Spinner />;
  }

  return children;
};

export default CognitoAuth;
