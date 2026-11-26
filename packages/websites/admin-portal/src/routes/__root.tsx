/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { RestrictedPortal } from '@discava/common-shadcn/components/restricted-portal';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { isInGroup } from '@discava/common-web-utils/groups';
import { useRuntimeConfig } from '@discava/common-web-utils/runtime-config';
import { signOut } from '@discava/common-web-utils/sign-out';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { useAuth } from 'react-oidc-context';
import { AdminBrandSync } from '../components/admin-brand-sync';
import AppLayout from '../components/app-layout';
import { NotFoundPage } from '../components/not-found-page';
import type { RouterProviderContext } from '../router-context';

export const Route = createRootRouteWithContext<RouterProviderContext>()({
  component: AdminsOnly,
  notFoundComponent: NotFoundPage,
});

// The portal is for the `admin` group; anyone else signed in gets a page
// saying so, pointing to the portals they can use (#235).
function AdminsOnly() {
  const auth = useAuth();
  const { localOidc, portals } = useRuntimeConfig();
  const profile = auth.user?.profile;

  if (isInGroup(profile, 'admin')) {
    // Mounted here, not in main.tsx: branding.get is admin-only, so anyone
    // else would only collect 403s.
    return (
      <AppLayout>
        <AdminBrandSync />
        <Outlet />
      </AppLayout>
    );
  }

  const name = profile?.given_name ?? profile?.email ?? 'someone';
  const links = [
    isInGroup(profile, 'instructor') && portals?.InstructorPortal
      ? { label: 'Go to the instructor portal', href: portals.InstructorPortal }
      : undefined,
    portals?.StudentPortal
      ? { label: 'Go to the student portal', href: portals.StudentPortal }
      : undefined,
  ].filter((link) => link !== undefined);
  return (
    <RestrictedPage
      name={name}
      links={links}
      onSignOut={() => signOut(auth, { localOidc })}
    />
  );
}

// Rendered only in the restricted branch: a title set in AdminsOnly itself
// would run after the admin pages' effects and overwrite theirs.
function RestrictedPage({
  name,
  links,
  onSignOut,
}: {
  name: string;
  links: { label: string; href: string }[];
  onSignOut: () => void;
}) {
  usePageTitle('Administrators only');
  return (
    <RestrictedPortal
      title="The admin portal is for administrators"
      links={links}
      onSignOut={onSignOut}
    >
      <p>You're signed in as {name}, who isn't an administrator.</p>
    </RestrictedPortal>
  );
}
