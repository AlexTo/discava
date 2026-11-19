/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MAIN_CONTENT_ID,
  SkipLink,
} from '@discava/common-shadcn/components/skip-link';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { TooltipProvider } from '@discava/common-shadcn/components/ui/tooltip';
import Config from '@discava/common-web-utils/app-config';
import { isInGroup } from '@discava/common-web-utils/groups';
import { useRuntimeConfig } from '@discava/common-web-utils/runtime-config';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import { NotificationBell } from './NotificationBell';
import { SiteSearch } from './SiteSearch';
import { UserMenu } from './UserMenu';

const DISCAVA_URL = 'https://alexto.github.io/discava';

// The one layout every page uses, signed in or not: a top bar with the
// course search and, once signed in, My Learning (and, for an instructor, a
// link to the instructor portal), then the page.
// There's no app-wide sidebar; a course's own pages bring their outline.
const SiteLayout = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated, user } = useAuth();
  const { portals } = useRuntimeConfig();
  // To My Courses rather than the portal's home: a page that needs signing in,
  // which the Cognito session then does without asking (#67).
  const instructorPortal =
    isInGroup(user?.profile, 'instructor') && portals?.InstructorPortal
      ? `${portals.InstructorPortal}/my-courses`
      : undefined;

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex min-h-screen flex-col">
        <SkipLink />
        <header className="sticky top-0 z-50 flex h-16 items-center justify-between gap-4 border-b bg-background/90 px-6 backdrop-blur lg:px-8">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <img
              width={40}
              height={40}
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
            <div className="flex shrink-0 items-center gap-2">
              {instructorPortal ? (
                <Button variant="ghost" asChild>
                  <a href={instructorPortal}>Instructor</a>
                </Button>
              ) : null}
              <Button variant="ghost" asChild>
                <Link
                  to="/my-learning"
                  activeProps={{
                    'aria-current': 'page',
                    className: 'bg-accent',
                  }}
                >
                  My Learning
                </Link>
              </Button>
              <NotificationBell />
              <UserMenu />
            </div>
          ) : (
            <Button className="shrink-0" asChild>
              <Link to="/signin">Sign in</Link>
            </Button>
          )}
        </header>
        <div
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="flex flex-1 flex-col focus-visible:outline-none"
        >
          {children}
        </div>
        <footer className="border-t px-6 py-4 text-center text-xs text-muted-foreground lg:px-8">
          Powered by{' '}
          <a
            href={DISCAVA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline-offset-4 hover:underline"
          >
            Discava
          </a>
        </footer>
      </div>
    </TooltipProvider>
  );
};

export default SiteLayout;
