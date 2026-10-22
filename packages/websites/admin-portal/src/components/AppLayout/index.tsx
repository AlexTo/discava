/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Avatar,
  AvatarFallback,
} from '@discava/common-shadcn/components/ui/avatar';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@discava/common-shadcn/components/ui/breadcrumb';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@discava/common-shadcn/components/ui/dropdown-menu';
import { Separator } from '@discava/common-shadcn/components/ui/separator';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@discava/common-shadcn/components/ui/sidebar';
import { signOut } from '@discava/common-web-utils/sign-out';
import { Link, useLocation, useMatchRoute } from '@tanstack/react-router';
import * as React from 'react';
import { useAuth } from 'react-oidc-context';
import Config from '../../config';
import { useRuntimeConfig } from '../../hooks/useRuntimeConfig';
import { AppSidebar } from '../app-sidebar';

const getBreadcrumbs = (
  matchRoute: ReturnType<typeof useMatchRoute>,
  pathName: string,
  search: string,
  defaultBreadcrumb: string,
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
      href: matched ? `${href}${search}` : '#',
      text: segment,
    };
  });
};

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const auth = useAuth();
  const { user } = auth;
  const { localOidc } = useRuntimeConfig();
  const [activeBreadcrumbs, setActiveBreadcrumbs] = React.useState<
    { href: string; text: string }[]
  >([{ text: '/', href: '/' }]);
  const matchRoute = useMatchRoute();
  const { pathname, search } = useLocation();

  React.useEffect(() => {
    const breadcrumbs = getBreadcrumbs(
      matchRoute,
      pathname,
      Object.entries(search).reduce((p, [k, v]) => p + `${k}=${v}`, ''),
      '/',
    );
    setActiveBreadcrumbs(breadcrumbs);
  }, [matchRoute, pathname, search]);

  return (
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
            <DropdownMenu>
              <DropdownMenuTrigger
                className="focus-visible:ring-ring/60 cursor-pointer rounded-full shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label="Open user menu"
              >
                <Avatar size="lg" className="border border-border/60">
                  <AvatarFallback className="font-semibold hover:bg-muted/80">
                    {(user?.profile?.['cognito:username'] as any)
                      ?.charAt?.(0)
                      ?.toUpperCase?.()}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuLabel className="font-semibold">
                  Hi, {user?.profile?.['cognito:username'] as any}!
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer"
                  // The same sign-out as the other portals, which works with
                  // Cognito (it ignores signoutRedirect's parameter).
                  onSelect={() => signOut(auth, { localOidc })}
                >
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
  );
};

export default AppLayout;
