/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { safeReturnTo } from '@discava/common-shadcn/lib/return-to';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useAuth } from 'react-oidc-context';
import { Spinner } from '../components/spinner';

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
  // `auth` is a fresh object on every render, so this effect must guard
  // against re-invoking signinRedirect() on each re-render — otherwise a
  // signinRedirect() call that doesn't navigate away (e.g. it rejects
  // because no Cognito domain is configured yet) causes an infinite
  // render loop instead of just failing once.
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
      // Cognito hands the state back to CognitoAuth's onSigninCallback.
      auth.signinRedirect({ state: { returnTo } });
    }
  }, [auth, navigate, returnTo]);

  return <Spinner />;
}
