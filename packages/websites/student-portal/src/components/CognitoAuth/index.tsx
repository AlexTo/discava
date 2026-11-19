/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { safeReturnTo } from '@discava/common-web-utils/return-to';
import { useRuntimeConfig } from '@discava/common-web-utils/runtime-config';
import React, { PropsWithChildren } from 'react';
import { AuthProvider, AuthProviderProps, useAuth } from 'react-oidc-context';
import { router } from '../../router';

/**
 * Sets up sign-in: with Cognito, from runtime-config.json's cognitoProps, or
 * in local-dev mode with the local OIDC server the runtime config override
 * sets as `localOidc` (#226).
 */
const CognitoAuth: React.FC<PropsWithChildren> = ({ children }) => {
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
    // Back to the page sign-in started from (the OIDC state signin.tsx
    // sends), or home. Also clears the code from the URL.
    onSigninCallback: (user) => {
      const returnTo = safeReturnTo(
        (user as { state?: { returnTo?: unknown } } | void)?.state?.returnTo,
      );
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
      <ErrorAlert type="error" header="Couldn't sign you in">
        <p>
          We couldn't reach the sign-in service. Please refresh the page or try
          again later.
        </p>
      </ErrorAlert>
    );
  }

  if (auth.isLoading) {
    return <Spinner />;
  }

  return children;
};

export default CognitoAuth;
