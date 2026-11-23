/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useBreadcrumbLabel } from '@discava/common-shadcn/components/breadcrumb-label';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { Link } from '@tanstack/react-router';

// What an address with no page shows. It draws no shell of its own: the root
// route renders it inside the shell, for administrators only.
export const NotFoundPage = () => {
  usePageTitle('Page not found');
  useBreadcrumbLabel('Page not found');

  return (
    <div className="w-full space-y-4 pb-8">
      <h1 className="text-balance text-2xl font-bold tracking-tight">
        Page not found
      </h1>
      <p className="text-sm text-muted-foreground">
        There's no page at this address.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link to="/">Go to the home page</Link>
      </Button>
    </div>
  );
};

export default NotFoundPage;
