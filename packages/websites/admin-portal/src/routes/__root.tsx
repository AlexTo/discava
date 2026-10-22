/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { RestrictedPortal } from '@discava/common-shadcn/components/restricted-portal';
import { isInGroup } from '@discava/common-web-utils/groups';
import { signOut } from '@discava/common-web-utils/sign-out';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { useAuth } from 'react-oidc-context';
import AppLayout from '../components/AppLayout';
import { useRuntimeConfig } from '../hooks/useRuntimeConfig';
import { RouterProviderContext } from '../main';

export const Route = createRootRouteWithContext<RouterProviderContext>()({
  component: AdminsOnly,
});

// The portal is for the `admin` group; anyone else signed in gets a page
// saying so, pointing to the portals they can use (#235).
function AdminsOnly() {
  const auth = useAuth();
  const { localOidc, portals } = useRuntimeConfig();
  const profile = auth.user?.profile;

  if (isInGroup(profile, 'admin')) {
    return (
      <AppLayout>
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
    <RestrictedPortal
      title="The admin portal is for administrators"
      links={links}
      onSignOut={() => signOut(auth, { localOidc })}
    >
      <p>You're signed in as {name}, who isn't an administrator.</p>
    </RestrictedPortal>
  );
}
