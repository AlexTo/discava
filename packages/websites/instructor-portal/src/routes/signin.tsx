/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { safeReturnTo } from '@discava/common-web-utils/return-to';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useAuth } from 'react-oidc-context';

export const Route = createFileRoute('/signin')({
  // `redirect`: the page to come back to, e.g. a deep link opened while
  // signed out.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string' ? { redirect: search.redirect } : {},
  component: RouteComponent,
});

function RouteComponent() {
  const auth = useAuth();
  const navigate = useNavigate();
  const returnTo = safeReturnTo(Route.useSearch().redirect);
  // `auth` is a fresh object on every render, so without this guard a
  // signinRedirect() that doesn't navigate away (e.g. it rejects) would be
  // retried on every render, looping forever instead of failing once.
  const signinAttempted = useRef(false);

  useEffect(() => {
    if (auth.isLoading) {
      return;
    }
    if (auth.isAuthenticated) {
      if (returnTo) {
        navigate({ href: returnTo, replace: true });
      } else {
        navigate({ to: '/', replace: true });
      }
      return;
    }
    if (!signinAttempted.current) {
      signinAttempted.current = true;
      // The sign-in provider hands the state back to CognitoAuth's
      // onSigninCallback.
      auth.signinRedirect({ state: { returnTo } });
    }
  }, [auth, navigate, returnTo]);

  return <Spinner />;
}
