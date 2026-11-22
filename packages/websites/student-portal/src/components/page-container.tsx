/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { cn } from '@discava/common-shadcn/lib/utils';
import type { ReactNode } from 'react';

// One width and one top offset for every page, so the breadcrumb and heading
// sit in the same place when a student moves between pages.
export const PAGE_CONTAINER_CLASS =
  'mx-auto w-full max-w-7xl px-6 py-10 lg:px-8';

export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className={cn(PAGE_CONTAINER_CLASS, className)}>{children}</main>
  );
}
