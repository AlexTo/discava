/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@discava/common-shadcn/components/ui/button';
import { Link } from '@tanstack/react-router';
import AppLayout from './app-layout';

// What an address with no page shows: inside the portal's shell, with a way
// back.
export const NotFound = () => (
  <AppLayout>
    <div className="w-full space-y-4 pb-8">
      <h1 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
        Page not found
      </h1>
      <p className="text-sm text-muted-foreground">
        There is no page at this address. It may have moved, or the link may be
        wrong.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link to="/">Go to the home page</Link>
      </Button>
    </div>
  </AppLayout>
);
