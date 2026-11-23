/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Skeleton } from '@discava/common-shadcn/components/ui/skeleton';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { type ReactNode, useLayoutEffect, useRef } from 'react';

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
  const list = useRef<HTMLUListElement>(null);
  // The row count when Load more was pressed: the first new row is at that
  // index, and takes focus once it renders, even when the button goes with
  // the last page.
  const loadedFrom = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (loadedFrom.current === undefined || rows.length <= loadedFrom.current) {
      return;
    }
    const row = list.current?.children[loadedFrom.current];
    loadedFrom.current = undefined;
    if (row instanceof HTMLElement) {
      row.tabIndex = -1;
      row.focus();
    }
  }, [rows.length]);

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
      <ul ref={list} aria-label={label} className="divide-y rounded-xl border">
        {rows.map((row) => renderRow(row))}
      </ul>
      {query.hasNextPage ? (
        <Button
          variant="outline"
          onClick={() => {
            loadedFrom.current = rows.length;
            void query.fetchNextPage();
          }}
          disabled={query.isFetchingNextPage}
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}
