/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type PortalNavItem,
  PortalShell,
} from '@discava/common-shadcn/components/portal-shell';
import { Button } from '@discava/common-shadcn/components/ui/button';
import type { UserMenuItem } from '@discava/common-shadcn/components/user-menu';
import { useRuntimeConfig } from '@discava/common-web-utils/runtime-config';
import { BarChart3, BookOpen, Home } from 'lucide-react';
import type * as React from 'react';

const navItems: PortalNavItem[] = [
  { label: 'Home', to: '/', icon: Home },
  { label: 'Dashboard', to: '/dashboard', icon: BarChart3 },
  { label: 'My Courses', to: '/my-courses', icon: BookOpen },
];

// Static labels for path segments that don't come from an entity a route
// might load (e.g. a course title) - those instead go through
// useBreadcrumbLabel.
const segmentLabels = { 'my-courses': 'My Courses' };

const userMenuItems: UserMenuItem[] = [
  { label: 'Public profile', to: '/profile' },
];

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const { portals } = useRuntimeConfig();
  // Back to the student portal (#67), at My Learning rather than its public
  // home: a page that needs signing in, which the Cognito session then does
  // without asking. Everyone here is an instructor (#235), so it always shows.
  const studentPortal = portals?.StudentPortal
    ? `${portals.StudentPortal}/my-learning`
    : undefined;

  return (
    <PortalShell
      portal="instructor"
      label="Instructor"
      navItems={navItems}
      segmentLabels={segmentLabels}
      userMenuItems={userMenuItems}
      headerActions={
        studentPortal ? (
          <Button variant="ghost" asChild>
            <a href={studentPortal}>Student</a>
          </Button>
        ) : null
      }
    >
      {children}
    </PortalShell>
  );
};

export default AppLayout;
