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
import { cn } from '@discava/common-shadcn/lib/utils';
import { Link, type LinkOptions } from '@tanstack/react-router';
import { Fragment } from 'react';

// One step of the trail: a page above this one, with its link, or this page
// itself, the last crumb, which needs none.
export type Crumb = { label: string; link?: LinkOptions };

/**
 * Where a page sits, from Home down to the page itself, e.g. Home › My
 * Learning › Linear Algebra › Projections. Each page passes its own trail:
 * the portal's paths (/learn/<course>/lesson/<lesson>) don't name the pages
 * above it, so they can't be read off the URL as the instructor portal does.
 */
export function PageBreadcrumbs({
  crumbs,
  className,
}: {
  crumbs: Crumb[];
  className?: string;
}) {
  const trail: Crumb[] = [{ label: 'Home', link: { to: '/' } }, ...crumbs];
  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>
        {trail.map((crumb, index) => {
          const isLast = index === trail.length - 1;
          return (
            <Fragment key={`${index}-${crumb.label}`}>
              <BreadcrumbItem className={cn(isLast && 'min-w-0')}>
                {isLast || !crumb.link ? (
                  <BreadcrumbPage className="truncate">
                    {crumb.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link {...crumb.link}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {isLast ? null : <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
