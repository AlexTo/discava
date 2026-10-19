/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@discava/common-shadcn/components/ui/button';
import { TooltipProvider } from '@discava/common-shadcn/components/ui/tooltip';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import Config from '../config';
import { SiteSearch } from './SiteSearch';
import { UserMenu } from './UserMenu';

// The one layout every page uses, signed in or not: a top bar with the
// course search, then the page.
// There's no app-wide sidebar; a course's own pages bring their outline.
const SiteLayout = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated } = useAuth();

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-50 flex h-16 items-center justify-between gap-4 border-b bg-background/90 px-6 backdrop-blur lg:px-8">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <img
              alt={`${Config.applicationName} logo`}
              className="size-10 rounded-lg border border-border/60 bg-background object-cover shadow-sm"
              src={Config.logo}
            />
            <span className="hidden text-sm font-semibold sm:inline">
              {Config.applicationName}
            </span>
          </Link>
          <div className="flex min-w-0 flex-1 justify-center">
            <SiteSearch />
          </div>
          {isAuthenticated ? (
            <UserMenu />
          ) : (
            <Button className="shrink-0" asChild>
              <Link to="/signin">Sign in</Link>
            </Button>
          )}
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
      </div>
    </TooltipProvider>
  );
};

export default SiteLayout;
