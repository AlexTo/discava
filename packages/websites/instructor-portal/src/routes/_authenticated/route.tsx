/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import AppLayout from '../../components/AppLayout';

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: ({ context, location }) => {
    // Sign-in is required whenever there's somewhere to sign in: Cognito, or
    // local dev's OIDC server (#226). Only with neither (local-dev mode with
    // no runtime config) is it bypassed, as CognitoAuth does too.
    const { cognitoProps, oidc } = context.runtimeConfig ?? {};
    if ((cognitoProps || oidc) && !context.auth?.isAuthenticated) {
      // Back to the requested page once signed in (see signin.tsx).
      throw redirect({ to: '/signin', search: { redirect: location.href } });
    }
  },
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
});
