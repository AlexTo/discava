/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Skeleton } from '@discava/common-shadcn/components/ui/skeleton';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import type { ReactNode } from 'react';

// The loading, empty, error, rows and "Load more" states every view shares.
export function PagedList<T>({
  query,
  rows,
  emptyText,
  errorText,
  label,
  renderRow,
}: {
  query: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    isFetching: boolean;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    refetch: () => unknown;
    fetchNextPage: () => unknown;
  };
  rows: T[];
  emptyText: string;
  errorText: string;
  label: string;
  renderRow: (row: T) => ReactNode;
}) {
  if (query.isPending) {
    return (
      <div className="space-y-3" role="status" aria-label={`Loading ${label}`}>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div role="alert" className="space-y-3 text-sm">
        <p className="text-destructive">
          {apiErrorMessage(query.error, errorText)}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          Try again
        </Button>
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <div className="space-y-4">
      <ul aria-label={label} className="divide-y rounded-xl border">
        {rows.map((row) => renderRow(row))}
      </ul>
      {query.hasNextPage ? (
        <Button
          variant="outline"
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}
