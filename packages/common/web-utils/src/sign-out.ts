/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AuthContextProps } from 'react-oidc-context';

// Signs the user out of the portal and of the sign-in server, then back to the
// portal's home page.
//
// Cognito's `end_session_endpoint` doesn't honour the OIDC-standard
// `post_logout_redirect_uri` param that `signoutRedirect()` sends - it
// requires its own `logout_uri` param instead, so we build the redirect
// manually from the discovered endpoint. Local dev's OIDC server takes the
// standard parameter (#226), hence `localOidc`.
export const signOut = async (
  auth: Pick<AuthContextProps, 'settings' | 'removeUser'>,
  { localOidc }: { localOidc?: unknown },
): Promise<void> => {
  let endSessionEndpoint: string | undefined;
  try {
    const metadataUrl = `${auth.settings.authority}/.well-known/openid-configuration`;
    const metadata = await (await fetch(metadataUrl)).json();
    endSessionEndpoint = metadata.end_session_endpoint;
  } catch {
    // fall through to a local-only sign out below
  }
  if (endSessionEndpoint) {
    const logoutUrl = new URL(endSessionEndpoint);
    logoutUrl.searchParams.set('client_id', auth.settings.client_id);
    logoutUrl.searchParams.set(
      localOidc ? 'post_logout_redirect_uri' : 'logout_uri',
      window.location.origin,
    );
    // Forget the user without telling the app, rather than removeUser(): that
    // re-renders the portal as signed out, and one that signs people in at
    // once (the admin portal) starts a sign-in that cancels this navigation
    // while the sign-in server's session is still alive, signing them straight
    // back in. Found on dev (#242). The key is oidc-client-ts's own; its
    // settings always have a store, though the type leaves it optional.
    const { userStore } = auth.settings;
    if (userStore) {
      await userStore.remove(
        `user:${auth.settings.authority}:${auth.settings.client_id}`,
      );
    } else {
      await auth.removeUser();
    }
    window.location.href = logoutUrl.toString();
  } else {
    await auth.removeUser();
    window.location.href = window.location.origin;
  }
};
