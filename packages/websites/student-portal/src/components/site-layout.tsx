/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { NotificationBell } from '@discava/common-shadcn/components/notification-bell-container';
import { RouteAnnouncer } from '@discava/common-shadcn/components/route-announcer';
import {
  MAIN_CONTENT_ID,
  SkipLink,
} from '@discava/common-shadcn/components/skip-link';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { TooltipProvider } from '@discava/common-shadcn/components/ui/tooltip';
import { UserMenu } from '@discava/common-shadcn/components/user-menu';
import { useBrand } from '@discava/common-web-utils/brand';
import { isInGroup } from '@discava/common-web-utils/groups';
import { useRuntimeConfig } from '@discava/common-web-utils/runtime-config';
import { Link, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import { SiteSearch } from './site-search';

const DISCAVA_URL = 'https://alexto.github.io/discava';

// The one layout every page uses, signed in or not: a top bar with the
// course search and, once signed in, My Learning (and, for an instructor, a
// link to the instructor portal), then the page.
// There's no app-wide sidebar; a course's own pages bring their outline.
const SiteLayout = ({ children }: { children: ReactNode }) => {
  const brand = useBrand();
  const { isAuthenticated, user } = useAuth();
  const { portals } = useRuntimeConfig();
  // Only the path: a filter or tab change is not a new page. The resolved
  // location, because `location` changes while the old page is still shown,
  // and focus would go to its heading.
  const pathname = useRouterState({
    select: (state) => (state.resolvedLocation ?? state.location).pathname,
  });
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
        <RouteAnnouncer containerId={MAIN_CONTENT_ID} pathname={pathname} />
        <header className="sticky top-0 z-50 flex h-16 items-center justify-between gap-4 border-b bg-background/90 px-6 backdrop-blur lg:px-8">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <img
              height={40}
              alt={`${brand.name} logo`}
              className="h-10 w-auto max-w-40 shrink object-contain"
              src={brand.logoUrl}
            />
            <span className="hidden text-sm font-semibold sm:inline">
              {brand.name}
            </span>
          </Link>
          <div className="flex min-w-0 flex-1 justify-center">
            <SiteSearch />
          </div>
          {isAuthenticated ? (
            <div className="flex shrink-0 items-center gap-2">
              {/* Below sm the same two links are the user menu's first entries. */}
              <div className="hidden items-center gap-2 sm:flex">
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
              </div>
              <NotificationBell portal="student" />
              <UserMenu
                items={[
                  {
                    label: 'My Learning',
                    to: '/my-learning',
                    className: 'sm:hidden',
                  },
                  ...(instructorPortal
                    ? [
                        {
                          label: 'Instructor',
                          to: instructorPortal,
                          className: 'sm:hidden',
                        },
                      ]
                    : []),
                ]}
              />
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
