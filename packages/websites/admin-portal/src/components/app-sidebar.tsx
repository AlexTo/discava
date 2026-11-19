/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@discava/common-shadcn/components/ui/sidebar';
import { Link } from '@tanstack/react-router';
import { Home, MessageSquareText, Tags } from 'lucide-react';

export function AppSidebar() {
  // Menu items.
  const navItems = [
    {
      label: 'Home',
      to: '/',
      icon: Home,
    },
    {
      label: 'Categories',
      to: '/categories',
      icon: Tags,
    },
    {
      label: 'Reviews',
      to: '/reviews',
      icon: MessageSquareText,
    },
  ];
  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Admin</SidebarGroupLabel>
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
    </Sidebar>
  );
}
