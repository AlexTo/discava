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
import { signOut } from '@discava/common-web-utils/sign-out';
import { useAuth } from 'react-oidc-context';
import { useRuntimeConfig } from '../../hooks/useRuntimeConfig';
import { getUserIdentity } from './user-profile';

export const UserMenu = () => {
  const auth = useAuth();
  const { user } = auth;
  const { localOidc } = useRuntimeConfig();
  const { displayName, initials } = getUserIdentity(user?.profile);

  const handleSignOut = () => signOut(auth, { localOidc });

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
