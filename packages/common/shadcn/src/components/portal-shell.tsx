/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useBrand } from '@discava/common-web-utils/brand';
import { Link, useLocation, useRouter } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';
import {
  BreadcrumbOverrideContext,
  type CrumbOptions,
} from './breadcrumb-label';
import { NotificationBell, type Portal } from './notification-bell-container';
import { RouteAnnouncer } from './route-announcer';
import { MAIN_CONTENT_ID, SkipLink } from './skip-link';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './ui/breadcrumb';
import { Separator } from './ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from './ui/sidebar';
import { UserMenu, type UserMenuItem } from './user-menu';

export interface Crumb {
  /** Absent when no page exists at the crumb's path. */
  href?: string;
  text: string;
}

// A crumb links to its own path only: the current page's search params (a new
// quiz's lesson, say) mean nothing to the pages above it. A crumb whose path
// has no page of its own is text, not a link.
export const getBreadcrumbs = (
  routeExists: (href: string) => boolean,
  pathName: string,
  defaultBreadcrumb: string,
  overrides: Record<string, string>,
  segmentLabels: Record<string, string> = {},
  fallbackLabels: Record<string, string> = {},
  crumbOptions: Record<string, CrumbOptions> = {},
): Crumb[] => {
  const segments = [
    defaultBreadcrumb,
    ...pathName.split('/').filter((segment) => segment !== ''),
  ];

  const crumbs: Crumb[] = [];
  segments.forEach((segment, i) => {
    const href =
      i === 0
        ? '/'
        : `/${segments
            .slice(1, i + 1)
            .join('/')
            .replace('//', '/')}`;

    const options = crumbOptions[href];
    if (options?.hidden) return;
    crumbs.push({
      href: options?.href ?? (routeExists(href) ? href : undefined),
      text:
        overrides[href] ??
        segmentLabels[segment] ??
        fallbackLabels[segment] ??
        segment,
    });
  });
  return crumbs;
};

export interface PortalNavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

export interface PortalShellProps {
  /** The portal this shell is in, for the notification bell's links. */
  portal: Portal;
  /** The sidebar group's label. */
  label: string;
  navItems: PortalNavItem[];
  /**
   * Labels for path segments that aren't titles of anything a route loads
   * (e.g. 'my-courses' -> 'My Courses'). Titles a route loads go through
   * `useBreadcrumbLabel` instead, keyed by full pathname. Keep the object the
   * same between renders (a module constant).
   */
  segmentLabels?: Record<string, string>;
  /**
   * Neutral labels for path parameters (param name -> label, e.g. courseId ->
   * 'Course'), shown for a crumb whose title is not available (still loading
   * or failed) so a raw ID never reaches the breadcrumb. Keep the object the
   * same between renders (a module constant).
   */
  paramLabels?: Record<string, string>;
  /** Shown in the header before the notification bell. */
  headerActions?: React.ReactNode;
  /** Links only this portal has in the user menu. A module constant. */
  userMenuItems?: UserMenuItem[];
  children: React.ReactNode;
}

// The sidebar. On a phone it closes when the page changes, and when it closes
// otherwise (Escape, its close button) focus returns to the menu button; after
// a navigation focus goes to the new page's h1.
const ShellSidebar = ({
  pathname,
  triggerRef,
  children,
}: {
  pathname: string;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  children: React.ReactNode;
}) => {
  const { openMobile, setOpenMobile } = useSidebar();
  const openRef = React.useRef(openMobile);
  openRef.current = openMobile;
  const previous = React.useRef(pathname);
  const navigating = React.useRef(false);

  React.useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    // Only a sheet that is open closes, and so only then does
    // onCloseAutoFocus follow to clear this.
    if (!openRef.current) return;
    navigating.current = true;
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  const onCloseAutoFocus = React.useCallback(
    (event: Event) => {
      event.preventDefault();
      if (navigating.current) {
        navigating.current = false;
        // The sheet held focus while RouteAnnouncer moved it, and gave up
        // the page's heading when it closed: put focus on it again.
        const heading = document
          .getElementById(MAIN_CONTENT_ID)
          ?.querySelector<HTMLElement>('h1');
        if (heading) {
          heading.tabIndex = -1;
          heading.focus();
        } else {
          document.getElementById(MAIN_CONTENT_ID)?.focus();
        }
        return;
      }
      triggerRef.current?.focus();
    },
    [triggerRef],
  );

  return <Sidebar onCloseAutoFocus={onCloseAutoFocus}>{children}</Sidebar>;
};

// A portal's signed-in layout: the sidebar, a header with the notification
// bell and user menu, and breadcrumbs above the page.
export const PortalShell = ({
  portal,
  label,
  navItems,
  segmentLabels,
  paramLabels,
  headerActions,
  userMenuItems,
  children,
}: PortalShellProps) => {
  const [activeBreadcrumbs, setActiveBreadcrumbs] = React.useState<Crumb[]>([
    { text: 'Home', href: '/' },
  ]);
  const brand = useBrand();
  const router = useRouter();
  const { pathname } = useLocation();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
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

  const [crumbOptions, setCrumbOptionsState] = React.useState<
    Record<string, CrumbOptions>
  >({});

  const setCrumbOptions = React.useCallback(
    (path: string, options: CrumbOptions | undefined) => {
      setCrumbOptionsState((prev) => {
        if (options === undefined) {
          if (!(path in prev)) return prev;
          const next = { ...prev };
          delete next[path];
          return next;
        }
        const old = prev[path];
        if (old?.href === options.href && old?.hidden === options.hidden) {
          return prev;
        }
        return { ...prev, [path]: options };
      });
    },
    [],
  );

  // Memoized: consumers (useBreadcrumbLabel) depend on this identity.
  const breadcrumbOverrideContextValue = React.useMemo(
    () => ({ setOverride, setCrumbOptions }),
    [setOverride, setCrumbOptions],
  );

  React.useEffect(() => {
    // A page exists when the deepest match is a route of the href's own depth:
    // a path below a layout route (".../assignments" under a course) matches
    // the layout, but its page is not found.
    const depth = (path: string) => path.split('/').filter(Boolean).length;
    const routeExists = (href: string) => {
      const matches = router.matchRoutes(href);
      const deepest = matches[matches.length - 1];
      if (!deepest || deepest.status === 'notFound') return false;
      if (href === '/') return true;
      const route = router.routesById[deepest.routeId as never] as
        | { fullPath: string }
        | undefined;
      return (
        deepest.routeId !== '__root__' &&
        route !== undefined &&
        depth(route.fullPath) === depth(href)
      );
    };
    const matches = router.matchRoutes(pathname);
    const params = (matches[matches.length - 1]?.params ?? {}) as Record<
      string,
      unknown
    >;
    const fallbackLabels: Record<string, string> = {};
    for (const [name, value] of Object.entries(params)) {
      const fallback = paramLabels?.[name];
      if (fallback && typeof value === 'string') {
        fallbackLabels[value] = fallback;
      }
    }
    const breadcrumbs = getBreadcrumbs(
      routeExists,
      pathname,
      'Home',
      overrides,
      segmentLabels,
      fallbackLabels,
      crumbOptions,
    );
    setActiveBreadcrumbs(breadcrumbs);
  }, [router, pathname, overrides, crumbOptions, segmentLabels, paramLabels]);

  return (
    <BreadcrumbOverrideContext.Provider value={breadcrumbOverrideContextValue}>
      <SidebarProvider>
        <SkipLink />
        <RouteAnnouncer containerId={MAIN_CONTENT_ID} pathname={pathname} />
        <ShellSidebar pathname={pathname} triggerRef={triggerRef}>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>{label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton asChild>
                        <Link to={item.to} preload="intent">
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </ShellSidebar>
        <SidebarInset>
          <header className="supports-backdrop-blur:bg-background/60 sticky top-0 z-10 flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 border-b py-2 bg-background/80 px-4 backdrop-blur">
            <div className="flex min-w-0 items-center gap-3">
              <SidebarTrigger ref={triggerRef} className="-ml-1" />
              <Separator orientation="vertical" className="h-6" />
              <div className="flex min-w-0 items-center gap-2">
                <img
                  height={40}
                  alt={`${brand.name} logo`}
                  className="h-10 w-auto min-w-0 max-w-40 shrink object-contain"
                  src={brand.logoUrl}
                />
                {brand.showNameBesideLogo && (
                  <div className="hidden flex-col leading-tight sm:flex">
                    <span className="text-sm font-semibold">{brand.name}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
              {headerActions}
              <NotificationBell portal={portal} />
              <UserMenu items={userMenuItems} />
            </div>
          </header>
          <div
            id={MAIN_CONTENT_ID}
            tabIndex={-1}
            className="flex min-w-0 flex-1 flex-col gap-6 p-6 pt-4 focus-visible:outline-none"
          >
            <Breadcrumb>
              <BreadcrumbList className="break-words">
                {activeBreadcrumbs.map((crumb, index) => (
                  <React.Fragment key={crumb.href ?? `${index}-${crumb.text}`}>
                    <BreadcrumbItem className="min-w-0 max-w-full">
                      {index === activeBreadcrumbs.length - 1 || !crumb.href ? (
                        <BreadcrumbPage className="min-w-0 [overflow-wrap:anywhere]">
                          {crumb.text}
                        </BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink asChild>
                          <Link
                            to={crumb.href}
                            className="inline-flex min-h-6 min-w-0 items-center [overflow-wrap:anywhere]"
                          >
                            {crumb.text}
                          </Link>
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
