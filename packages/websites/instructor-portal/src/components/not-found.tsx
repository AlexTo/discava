/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@discava/common-shadcn/components/ui/button';
import { isInGroup } from '@discava/common-web-utils/groups';
import { Link } from '@tanstack/react-router';
import { useAuth } from 'react-oidc-context';
import AppLayout from './app-layout';

// What an address with no page shows. It draws no shell of its own: under
// `_authenticated` it renders inside the shell, after the sign-in and
// instructor checks have run.
export const NotFound = () => (
  <div className="w-full space-y-4 pb-8">
    <h1 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
      Page not found
    </h1>
    <p className="text-sm text-muted-foreground">
      There is no page at this address. It may have moved, or the link may be
      wrong.
    </p>
    <Button asChild variant="outline" size="sm">
      <Link to="/">Go to the home page</Link>
    </Button>
  </div>
);

// The router's fallback for an address that matches no route at all, so the
// sign-in redirect and the instructors-only page never ran. Only a signed-in
// instructor gets the shell; anyone else gets the bare page, whose link home
// sends them to sign in or to the instructors-only page.
export const RootNotFound = () => {
  const auth = useAuth();
  if (auth.isAuthenticated && isInGroup(auth.user?.profile, 'instructor')) {
    return (
      <AppLayout>
        <NotFound />
      </AppLayout>
    );
  }
  return (
    <div className="mx-auto max-w-xl p-6">
      <NotFound />
    </div>
  );
};
