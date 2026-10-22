/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ParsedLocation, redirect } from '@tanstack/react-router';
import type { RouterProviderContext } from '../router';

// A route's beforeLoad for pages only signed-in students see: sends anyone
// else to sign in, coming back here afterwards (see routes/signin.tsx).
// Required whenever there's somewhere to sign in: Cognito, or local dev's
// OIDC server (#226). Only with neither (local-dev mode with no runtime
// config) is it bypassed, as CognitoAuth does too.
export const requireSignIn = ({
  context,
  location,
}: {
  context: RouterProviderContext;
  location: ParsedLocation;
}) => {
  const { cognitoProps, oidc } = context.runtimeConfig ?? {};
  if ((cognitoProps || oidc) && !context.auth?.isAuthenticated) {
    throw redirect({ to: '/signin', search: { redirect: location.href } });
  }
};
