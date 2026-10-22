/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@discava/common-shadcn/components/ui/breadcrumb';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Separator } from '@discava/common-shadcn/components/ui/separator';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@discava/common-shadcn/components/ui/sidebar';
import { Link, useLocation, useMatchRoute } from '@tanstack/react-router';
import * as React from 'react';
import Config from '../../config';
import { useRuntimeConfig } from '../../hooks/useRuntimeConfig';
import { AppSidebar } from '../app-sidebar';
import { UserMenu } from '../UserMenu';
import { BreadcrumbOverrideContext } from './breadcrumb-label';

// Static labels for path segments that don't come from an entity a route
// might load (e.g. a course title) - those instead go through
// BreadcrumbOverrideContext, keyed by full pathname rather than segment.
const segmentLabels: Record<string, string> = {
  'my-courses': 'My Courses',
};

// A crumb links to its own path only: the current page's search params (a new
// quiz's lesson, say) mean nothing to the pages above it.
export const getBreadcrumbs = (
  matchRoute: ReturnType<typeof useMatchRoute>,
  pathName: string,
  defaultBreadcrumb: string,
  overrides: Record<string, string>,
  availableRoutes?: string[],
) => {
  const segments = [
    defaultBreadcrumb,
    ...pathName.split('/').filter((segment) => segment !== ''),
  ];

  return segments.map((segment, i) => {
    const href =
      i === 0
        ? '/'
        : `/${segments
            .slice(1, i + 1)
            .join('/')
            .replace('//', '/')}`;

    const matched =
      !availableRoutes || availableRoutes.find((r) => matchRoute({ to: href }));

    return {
      href: matched ? href : '#',
      text: overrides[href] ?? segmentLabels[segment] ?? segment,
    };
  });
};

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const { portals } = useRuntimeConfig();
  // Back to the student portal (#67), at My Learning rather than its public
  // home: a page that needs signing in, which the Cognito session then does
  // without asking. Everyone here is an instructor (#235), so it always shows.
  const studentPortal = portals?.StudentPortal
    ? `${portals.StudentPortal}/my-learning`
    : undefined;
  const [activeBreadcrumbs, setActiveBreadcrumbs] = React.useState<
    { href: string; text: string }[]
  >([{ text: '/', href: '/' }]);
  const matchRoute = useMatchRoute();
  const { pathname } = useLocation();
  const [overrides, setOverrides] = React.useState<Record<string, string>>({});

  const setOverride = React.useCallback(
    (path: string, label: string | undefined) => {
      setOverrides((prev) => {
        if (label === undefined) {
          if (!(path in prev)) return prev;
          const next = { ...prev };
          delete next[path];
          return next;
        }
        if (prev[path] === label) return prev;
        return { ...prev, [path]: label };
      });
    },
    [],
  );

  // Memoized: consumers (useBreadcrumbLabel) depend on this identity.
  const breadcrumbOverrideContextValue = React.useMemo(
    () => ({ setOverride }),
    [setOverride],
  );

  React.useEffect(() => {
    const breadcrumbs = getBreadcrumbs(matchRoute, pathname, '/', overrides);
    setActiveBreadcrumbs(breadcrumbs);
  }, [matchRoute, pathname, overrides]);

  return (
    <BreadcrumbOverrideContext.Provider value={breadcrumbOverrideContextValue}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="supports-backdrop-blur:bg-background/60 sticky top-0 z-10 flex h-16 items-center gap-4 border-b bg-background/80 px-4 backdrop-blur">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="h-6" />
              <div className="flex items-center gap-2">
                <img
                  alt={`${Config.applicationName} logo`}
                  className="size-10 rounded-lg border border-border/60 bg-background object-cover shadow-sm"
                  src={Config.logo}
                />
                <div className="flex flex-col leading-tight">
                  <span className="text-sm font-semibold">
                    {Config.applicationName}
                  </span>
                </div>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              {studentPortal ? (
                <Button variant="ghost" asChild>
                  <a href={studentPortal}>Student</a>
                </Button>
              ) : null}
              <UserMenu />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-6 p-6 pt-4">
            <Breadcrumb>
              <BreadcrumbList>
                {activeBreadcrumbs.map((crumb, index) => (
                  <React.Fragment key={crumb.href || index}>
                    <BreadcrumbItem>
                      {index === activeBreadcrumbs.length - 1 ? (
                        <BreadcrumbPage>{crumb.text}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink asChild>
                          <Link to={crumb.href}>{crumb.text}</Link>
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                    {index < activeBreadcrumbs.length - 1 && (
                      <BreadcrumbSeparator />
                    )}
                  </React.Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </BreadcrumbOverrideContext.Provider>
  );
};

export default AppLayout;
