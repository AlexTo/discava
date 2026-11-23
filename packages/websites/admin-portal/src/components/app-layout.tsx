/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type PortalNavItem,
  PortalShell,
} from '@discava/common-shadcn/components/portal-shell';
import type { UserMenuItem } from '@discava/common-shadcn/components/user-menu';
import { Award, CreditCard, Home, MessageSquareText, Tags } from 'lucide-react';
import type * as React from 'react';

const navItems: PortalNavItem[] = [
  { label: 'Home', to: '/', icon: Home },
  { label: 'Categories', to: '/categories', icon: Tags },
  { label: 'Reviews', to: '/reviews', icon: MessageSquareText },
  { label: 'Certificates', to: '/certificates', icon: Award },
  { label: 'Payments', to: '/payments', icon: CreditCard },
];

// Static labels for path segments, which the breadcrumb would otherwise show
// as the raw URL segment.
export const segmentLabels = {
  categories: 'Categories',
  reviews: 'Reviews',
  certificates: 'Certificates',
  payments: 'Payments',
  settings: 'Settings',
  notifications: 'Notification settings',
  branding: 'Branding',
};

// Beside the shared "Notification settings" entry.
const userMenuItems: UserMenuItem[] = [
  { label: 'Branding', to: '/settings/branding' },
];

const AppLayout = ({ children }: { children: React.ReactNode }) => (
  <PortalShell
    portal="admin"
    label="Admin"
    navItems={navItems}
    segmentLabels={segmentLabels}
    userMenuItems={userMenuItems}
  >
    {children}
  </PortalShell>
);

export default AppLayout;
