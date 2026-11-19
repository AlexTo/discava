/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@discava/common-shadcn/components/ui/card';
import { Skeleton } from '@discava/common-shadcn/components/ui/skeleton';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import type { UseQueryResult } from '@tanstack/react-query';
import { formatDate, formatMoney } from './money';

interface Payout {
  payoutId: string;
  currency: string;
  amountMinor: number;
  status: 'pending' | 'sent' | 'failed';
  failureReason?: string;
  createdAt: string;
}

const STATUS_LABELS = { pending: 'Pending', sent: 'Sent', failed: 'Failed' };

/** The instructor's payouts, newest first. */
export function PayoutsList({
  overview,
}: {
  overview: UseQueryResult<{ payouts: Payout[] }, unknown>;
}) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-base">Payouts</CardTitle>
      </CardHeader>
      <CardContent>
        {overview.isPending ? (
          <Skeleton data-testid="payouts-skeleton" className="h-16 w-full" />
        ) : overview.isError ? (
          <div className="space-y-3">
            <ErrorAlert type="error" header="Couldn't load your payouts">
              {apiErrorMessage(overview.error)}
            </ErrorAlert>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => overview.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : overview.data.payouts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payouts yet.</p>
        ) : (
          <table aria-label="Payouts" className="w-full text-left text-sm">
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 text-right font-medium">Amount</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {overview.data.payouts.map((payout) => (
                <tr key={payout.payoutId} className="border-b last:border-0">
                  <td className="py-2">{formatDate(payout.createdAt)}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatMoney(payout.amountMinor, payout.currency)}
                  </td>
                  <td className="py-2">
                    {STATUS_LABELS[payout.status]}
                    {payout.status === 'failed' && payout.failureReason
                      ? `: ${payout.failureReason}`
                      : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
