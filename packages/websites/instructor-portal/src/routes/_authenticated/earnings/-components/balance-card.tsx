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

interface CurrencyBalance {
  currency: string;
  onHoldMinor: number;
  waitingMinor: number;
  readyMinor: number;
  heldMinor: number;
  nextReleaseAt?: string;
}

const HELD_EXPLANATION =
  'Earned before the platform changed its payment account. Contact the platform to be paid.';

function Figure({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

function Balance({ balance }: { balance: CurrencyBalance }) {
  const money = (amount: number) => formatMoney(amount, balance.currency);
  const negative = balance.readyMinor < 0 || balance.waitingMinor < 0;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{balance.currency}</h3>
      <dl className="grid gap-4 sm:grid-cols-3">
        <Figure label="On hold">
          {money(balance.onHoldMinor)}
          {balance.nextReleaseAt ? (
            <span className="block text-xs font-normal text-muted-foreground">
              Next release {formatDate(balance.nextReleaseAt)}
            </span>
          ) : null}
        </Figure>
        <Figure label="Waiting for account setup">
          {money(balance.waitingMinor)}
        </Figure>
        <Figure label="Ready">{money(balance.readyMinor)}</Figure>
      </dl>
      {negative ? (
        <p className="text-sm text-muted-foreground">
          A negative balance comes from refunds after earnings were counted. It
          is deducted from your next payout.
        </p>
      ) : null}
      {balance.heldMinor !== 0 ? (
        <div>
          <p className="text-sm">
            <span className="text-muted-foreground">Held: </span>
            <span className="font-semibold tabular-nums">
              {money(balance.heldMinor)}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">{HELD_EXPLANATION}</p>
        </div>
      ) : null}
    </div>
  );
}

/** What is on hold, waiting and ready to pay, per currency. */
export function BalanceCard({
  overview,
}: {
  overview: UseQueryResult<{ currencies: CurrencyBalance[] }, unknown>;
}) {
  return (
    <Card className="gap-4" aria-busy={overview.isPending}>
      <CardHeader>
        <CardTitle className="text-base" role="heading" aria-level={2}>
          Balance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {overview.isPending ? (
          <>
            <Skeleton data-testid="balance-skeleton" className="h-16 w-full" />
            <span className="sr-only">Loading…</span>
          </>
        ) : overview.isError ? (
          <div className="space-y-3">
            <ErrorAlert type="error" header="Couldn't load your balance">
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
        ) : overview.data.currencies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing to pay out yet.
          </p>
        ) : (
          overview.data.currencies.map((balance) => (
            <Balance key={balance.currency} balance={balance} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
