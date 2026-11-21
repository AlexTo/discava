/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { currentPath, safeReturnTo } from '@discava/common-web-utils/return-to';
import { useRuntimeConfig } from '@discava/common-web-utils/runtime-config';
import React, { PropsWithChildren, useEffect } from 'react';
import { AuthProvider, AuthProviderProps, useAuth } from 'react-oidc-context';
import { ErrorAlert } from './error-alert';
import { Spinner } from './ui/spinner';

export interface CognitoAuthProps extends PropsWithChildren {
  /**
   * Redirects to sign-in by itself when nobody is signed in, and renders the
   * children only once someone is. Without it the children render whether or
   * not they are (the portal's routes send people to sign in).
   */
  autoSignIn?: boolean;
  /**
   * Called with the path to show after sign-in: the page sign-in started from
   * (the OIDC state the portal sends), or `/`. It runs above the portal's
   * router, so it navigates however the portal can at that point.
   */
  onReturn: (path: string) => void;
}

/**
 * Sets up sign-in: with Cognito, from runtime-config.json's cognitoProps, or
 * in local-dev mode with the local OIDC server the runtime config override
 * sets as `localOidc` (#226).
 */
const CognitoAuth: React.FC<CognitoAuthProps> = ({
  children,
  autoSignIn = false,
  onReturn,
}) => {
  const { cognitoProps, localOidc } = useRuntimeConfig();

  if (!cognitoProps && !localOidc) {
    return (
      <ErrorAlert type="error" header="Runtime config configuration error">
        <p>
          The cognitoProps have not been configured in the runtime-config.json.
        </p>
      </ErrorAlert>
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
    // Also clears the code from the URL.
    onSigninCallback: (user) => {
      const returnTo = safeReturnTo(
        (user as { state?: { returnTo?: unknown } } | void)?.state?.returnTo,
      );
      onReturn(returnTo ?? '/');
    },
  };

  return (
    <AuthProvider {...cognitoAuthConfig}>
      <CognitoAuthInternal autoSignIn={autoSignIn}>
        {children}
      </CognitoAuthInternal>
    </AuthProvider>
  );
};

const CognitoAuthInternal: React.FC<
  PropsWithChildren<{ autoSignIn: boolean }>
> = ({ children, autoSignIn }) => {
  const auth = useAuth();

  useEffect(() => {
    if (autoSignIn && !auth.isAuthenticated && !auth.isLoading) {
      // The provider hands the state back to onSigninCallback above.
      auth.signinRedirect({ state: { returnTo: currentPath() } });
    }
  }, [autoSignIn, auth]);

  if (autoSignIn && auth.isAuthenticated) {
    return children;
  }

  if (auth.error) {
    return (
      <ErrorAlert type="error" header="Couldn't sign you in">
        <p>
          We couldn't reach the sign-in service. Please refresh the page or try
          again later.
        </p>
      </ErrorAlert>
    );
  }

  // `isLoading` is also true while a redirect the page started is under way
  // (`activeNavigator`): keep that page, e.g. the student portal's "Signing
  // you in…", on screen until the browser leaves.
  if (autoSignIn || (auth.isLoading && !auth.activeNavigator)) {
    return <Spinner />;
  }

  return children;
};

export default CognitoAuth;
