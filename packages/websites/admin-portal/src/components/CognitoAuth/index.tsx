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
 * Sets up sign-in: with Cognito, from runtime-config.json's cognitoProps, or
 * in local-dev mode with the local OIDC server the runtime config override
 * sets as `localOidc` (#226).
 */
const CognitoAuth: React.FC<PropsWithChildren> = ({ children }) => {
  const { cognitoProps, localOidc } = useRuntimeConfig();

  if (!cognitoProps && !localOidc) {
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
      localOidc?.authority ??
      `https://cognito-idp.${cognitoProps.region}.amazonaws.com/${cognitoProps.userPoolId}`,
    client_id: localOidc?.clientId ?? cognitoProps.userPoolWebClientId,
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
      <Alert type="error" header="Couldn't sign you in">
        <p>
          We couldn't reach the sign-in service. Please refresh the page or try
          again later.
        </p>
      </Alert>
    );
  }

  return <Spinner />;
};

export default CognitoAuth;
