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
  await auth.removeUser();
  if (endSessionEndpoint) {
    const logoutUrl = new URL(endSessionEndpoint);
    logoutUrl.searchParams.set('client_id', auth.settings.client_id);
    logoutUrl.searchParams.set(
      localOidc ? 'post_logout_redirect_uri' : 'logout_uri',
      window.location.origin,
    );
    window.location.href = logoutUrl.toString();
  } else {
    window.location.href = window.location.origin;
  }
};
