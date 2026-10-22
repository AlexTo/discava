/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  currentPath,
  safeReturnTo,
} from '@discava/common-shadcn/lib/return-to';
import React, { PropsWithChildren, useEffect } from 'react';
import { AuthProvider, AuthProviderProps, useAuth } from 'react-oidc-context';
import { useRuntimeConfig } from '../../hooks/useRuntimeConfig';
import { Alert } from '../alert';
import { Spinner } from '../spinner';

/**
 * Sets up the Cognito auth.
 *
 * This assumes a runtime-config.json file is present at '/'. In order for Auth to be set up automatically,
 * the runtime-config.json must have the cognitoProps set.
 */
const CognitoAuth: React.FC<PropsWithChildren> = ({ children }) => {
  const { cognitoProps, oidc } = useRuntimeConfig();

  if (!cognitoProps && !oidc) {
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
    // Local dev's OIDC server when it's configured (#226), else Cognito.
    authority:
      oidc?.authority ??
      `https://cognito-idp.${cognitoProps.region}.amazonaws.com/${cognitoProps.userPoolId}`,
    client_id: oidc?.clientId ?? cognitoProps.userPoolWebClientId,
    redirect_uri: window.location.origin,
    response_type: 'code',
    scope: 'email openid profile',
    // Back to the page sign-in started from (the OIDC state sent below), or
    // home, which also clears the code from the URL. The router isn't
    // created until signed in (see main.tsx), so it starts on that page.
    onSigninCallback: (user) => {
      const returnTo = safeReturnTo(
        (user as { state?: { returnTo?: unknown } } | void)?.state?.returnTo,
      );
      window.history.replaceState(null, '', returnTo ?? '/');
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

  useEffect(() => {
    if (!auth.isAuthenticated && !auth.isLoading) {
      // Cognito hands the state back to onSigninCallback above.
      auth.signinRedirect({ state: { returnTo: currentPath() } });
    }
  }, [auth]);

  if (auth.isAuthenticated) {
    return children;
  }

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

  return <Spinner />;
};

export default CognitoAuth;
