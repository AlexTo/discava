/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { createFileRoute } from '@tanstack/react-router';
import { useAuth } from 'react-oidc-context';
import { MarketingHome } from './-components/marketing-home';
import { SignedInHome } from './-components/signed-in-home';

// One home for everyone: a welcome and a few courses when signed out, the
// student's own home when signed in. The full catalogue is /courses.
export const Route = createFileRoute('/')({
  component: RouteComponent,
});

function RouteComponent() {
  const { isAuthenticated } = useAuth();
  usePageTitle('Home');
  return isAuthenticated ? <SignedInHome /> : <MarketingHome />;
}
