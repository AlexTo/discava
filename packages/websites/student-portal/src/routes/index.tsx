/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createFileRoute } from '@tanstack/react-router';
import { useAuth } from 'react-oidc-context';
import { Catalogue } from './-components/catalogue';
import { SignedInHome } from './-components/signed-in-home';

// One home for everyone, as on Coursera: the catalogue when signed out, the
// student's own home when signed in.
export const Route = createFileRoute('/')({
  component: RouteComponent,
});

function RouteComponent() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <SignedInHome /> : <Catalogue />;
}
