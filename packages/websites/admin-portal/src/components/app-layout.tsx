/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type PortalNavItem,
  PortalShell,
} from '@discava/common-shadcn/components/portal-shell';
import { Home, MessageSquareText, Tags } from 'lucide-react';
import type * as React from 'react';

const navItems: PortalNavItem[] = [
  { label: 'Home', to: '/', icon: Home },
  { label: 'Categories', to: '/categories', icon: Tags },
  { label: 'Reviews', to: '/reviews', icon: MessageSquareText },
];

const AppLayout = ({ children }: { children: React.ReactNode }) => (
  <PortalShell portal="admin" label="Admin" navItems={navItems}>
    {children}
  </PortalShell>
);

export default AppLayout;
