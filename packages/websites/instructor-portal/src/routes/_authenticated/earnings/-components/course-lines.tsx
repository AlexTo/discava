/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useInstructorApi } from '../../../../api';
import { formatDate, formatMoney } from './money';
import type { Period } from './period';

/** The orders behind one course's row, 50 at a time, with no buyer shown. */
export function CourseLines({
  courseId,
  period,
}: {
  courseId: string;
  period: Period;
}) {
  const trpc = useInstructorApi();
  const query = useInfiniteQuery(
    trpc.earnings.lines.infiniteQueryOptions(
      { courseId, ...period },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    ),
  );
  const lines = query.data?.pages.flatMap((page) => page.lines) ?? [];

  if (query.isPending) {
    return <p className="text-sm text-muted-foreground">Loading orders…</p>;
  }
  if (query.isError) {
    return (
      <ErrorAlert type="error" header="Couldn't load the orders">
        {apiErrorMessage(query.error)}
      </ErrorAlert>
    );
  }
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table aria-label="Orders" className="w-full text-left text-sm">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium">Date</th>
              <th className="px-2 py-2 font-medium">Order reference</th>
              <th className="px-2 py-2 font-medium">Type</th>
              <th className="px-2 py-2 text-right font-medium">Gross</th>
              <th className="px-2 py-2 text-right font-medium">Discount</th>
              <th className="px-2 py-2 text-right font-medium">Refund</th>
              <th className="px-2 py-2 text-right font-medium">Fee</th>
              <th className="px-2 py-2 text-right font-medium">Net</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.entryId} className="border-b last:border-0">
                <td className="whitespace-nowrap px-2 py-2">
                  {formatDate(line.occurredAt)}
                </td>
                <td className="px-2 py-2 font-mono text-xs">{line.orderId}</td>
                <td className="px-2 py-2">
                  {line.kind === 'sale' ? 'Sale' : 'Refund'}
                </td>
                <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                  {formatMoney(line.grossMinor, line.currency)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                  {formatMoney(line.discountMinor, line.currency)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                  {formatMoney(line.refundMinor, line.currency)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                  {formatMoney(line.feeMinor, line.currency)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                  {formatMoney(line.netMinor, line.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {query.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  );
}
