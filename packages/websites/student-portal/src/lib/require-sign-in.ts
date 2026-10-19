/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ParsedLocation, redirect } from '@tanstack/react-router';
import type { RouterProviderContext } from '../router';

// A route's beforeLoad for pages only signed-in students see: sends anyone
// else to sign in, coming back here afterwards (see routes/signin.tsx). Auth
// is bypassed in local-dev mode (no cognitoProps configured), matching the
// bypass CognitoAuth applies before the router mounts.
export const requireSignIn = ({
  context,
  location,
}: {
  context: RouterProviderContext;
  location: ParsedLocation;
}) => {
  if (context.runtimeConfig?.cognitoProps && !context.auth?.isAuthenticated) {
    throw redirect({ to: '/signin', search: { redirect: location.href } });
  }
};
