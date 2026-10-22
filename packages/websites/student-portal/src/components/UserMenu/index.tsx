/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Avatar,
  AvatarFallback,
} from '@discava/common-shadcn/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@discava/common-shadcn/components/ui/dropdown-menu';
import { useAuth } from 'react-oidc-context';
import { useRuntimeConfig } from '../../hooks/useRuntimeConfig';
import { getUserIdentity } from './user-profile';

export const UserMenu = () => {
  const auth = useAuth();
  const { user, removeUser } = auth;
  const { oidc } = useRuntimeConfig();
  const { displayName, initials } = getUserIdentity(user?.profile);

  // Cognito's `end_session_endpoint` doesn't honour the OIDC-standard
  // `post_logout_redirect_uri` param that `signoutRedirect()` sends - it
  // requires its own `logout_uri` param instead, so we build the redirect
  // manually from the discovered endpoint.
  const handleSignOut = async () => {
    let endSessionEndpoint: string | undefined;
    try {
      const metadataUrl = `${auth.settings.authority}/.well-known/openid-configuration`;
      const metadata = await (await fetch(metadataUrl)).json();
      endSessionEndpoint = metadata.end_session_endpoint;
    } catch {
      // fall through to a local-only sign out below
    }
    await removeUser();
    if (endSessionEndpoint) {
      const logoutUrl = new URL(endSessionEndpoint);
      logoutUrl.searchParams.set('client_id', auth.settings.client_id);
      // Local dev's OIDC server takes the standard parameter (#226).
      logoutUrl.searchParams.set(
        oidc ? 'post_logout_redirect_uri' : 'logout_uri',
        window.location.origin,
      );
      window.location.href = logoutUrl.toString();
    } else {
      window.location.href = window.location.origin;
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="focus-visible:ring-ring/60 cursor-pointer rounded-full shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label="Open user menu"
      >
        <Avatar size="lg" className="border border-border/60">
          <AvatarFallback className="font-semibold hover:bg-muted/80">
            {initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuLabel className="font-semibold">
          Hi, {displayName}!
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer" onSelect={handleSignOut}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
