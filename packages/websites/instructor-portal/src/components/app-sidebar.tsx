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
import { BarChart3, BookOpen, Home } from 'lucide-react';

export function AppSidebar() {
  // Menu items.
  const navItems = [
    {
      label: 'Home',
      to: '/',
      icon: Home,
    },
    {
      label: 'Dashboard',
      to: '/dashboard',
      icon: BarChart3,
    },
    {
      label: 'My Courses',
      to: '/my-courses',
      icon: BookOpen,
    },
  ];
  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Instructor</SidebarGroupLabel>
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
