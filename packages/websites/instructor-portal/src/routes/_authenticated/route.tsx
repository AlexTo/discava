/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { RestrictedPortal } from '@discava/common-shadcn/components/restricted-portal';
import { isInGroup } from '@discava/common-web-utils/groups';
import { signOut } from '@discava/common-web-utils/sign-out';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { useAuth } from 'react-oidc-context';
import AppLayout from '../../components/AppLayout';
import { getUserIdentity } from '../../components/UserMenu/user-profile';
import { useRuntimeConfig } from '../../hooks/useRuntimeConfig';

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: ({ context, location }) => {
    if (!context.auth?.isAuthenticated) {
      // Back to the requested page once signed in (see signin.tsx).
      throw redirect({ to: '/signin', search: { redirect: location.href } });
    }
  },
  component: InstructorsOnly,
});

// The portal is for the `instructor` group; anyone else signed in gets a page
// saying so, pointing to the student portal, instead of the portal's pages and
// its API's refusals (#235). instructor-api enforces the same rule.
function InstructorsOnly() {
  const auth = useAuth();
  const { localOidc, portals } = useRuntimeConfig();

  if (isInGroup(auth.user?.profile, 'instructor')) {
    return (
      <AppLayout>
        <Outlet />
      </AppLayout>
    );
  }

  const { displayName } = getUserIdentity(auth.user?.profile);
  return (
    <RestrictedPortal
      title="The instructor portal is for instructors"
      links={
        portals?.StudentPortal
          ? [{ label: 'Go to the student portal', href: portals.StudentPortal }]
          : []
      }
      onSignOut={() => signOut(auth, { localOidc })}
    >
      <p>You're signed in as {displayName}, who isn't an instructor.</p>
      <p>
        To learn on Discava, use the student portal. If you teach a course, ask
        an administrator to make you an instructor.
      </p>
    </RestrictedPortal>
  );
}
