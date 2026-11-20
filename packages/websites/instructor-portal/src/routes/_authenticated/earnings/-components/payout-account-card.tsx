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
import { useMutation, useQuery } from '@tanstack/react-query';
import { useInstructorApi } from '../../../../api';

type AccountStatus =
  | 'unavailable'
  | 'not_started'
  | 'in_progress'
  | 'active'
  | 'restricted';

const STATUS_LABELS: Record<Exclude<AccountStatus, 'unavailable'>, string> = {
  not_started: 'Not set up',
  in_progress: 'In progress',
  active: 'Active',
  restricted: 'Restricted',
};

const ONBOARDING_ACTIONS: Partial<Record<AccountStatus, string>> = {
  not_started: 'Set up payouts',
  in_progress: 'Continue setup',
  restricted: 'Fix account',
};

/** The instructor's payout account and the one thing to do about it. */
export function PayoutAccountCard() {
  const trpc = useInstructorApi();
  const account = useQuery(trpc.payout.account.queryOptions());
  const startOnboarding = useMutation(
    trpc.payout.startOnboarding.mutationOptions(),
  );
  const dashboardLink = useMutation(
    trpc.payout.dashboardLink.mutationOptions(),
  );

  // Stripe sends the instructor back to this page, which loads the account
  // afresh.
  const leave = ({ url }: { url: string }) => window.location.assign(url);
  const error = startOnboarding.error ?? dashboardLink.error;
  const busy = startOnboarding.isPending || dashboardLink.isPending;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-base">Payout account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {account.isPending ? (
          <Skeleton data-testid="account-skeleton" className="h-10 w-full" />
        ) : account.isError ? (
          <div className="space-y-3">
            <ErrorAlert type="error" header="Couldn't load your payout account">
              {apiErrorMessage(account.error)}
            </ErrorAlert>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => account.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : account.data.status === 'unavailable' ? (
          <p className="text-sm text-muted-foreground">
            Payouts aren't available yet
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              Status:{' '}
              <span className="font-medium">
                {STATUS_LABELS[account.data.status]}
              </span>
            </p>
            {ONBOARDING_ACTIONS[account.data.status] ? (
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  startOnboarding.mutate(
                    { returnPath: '/earnings' },
                    { onSuccess: leave },
                  )
                }
              >
                {ONBOARDING_ACTIONS[account.data.status]}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  dashboardLink.mutate(undefined, { onSuccess: leave })
                }
              >
                Open Stripe dashboard
              </Button>
            )}
          </div>
        )}
        {account.data?.stale ? (
          <p className="text-sm text-muted-foreground">
            Stripe can't be reached right now, so this is the last status we
            saw.
          </p>
        ) : null}
        {error ? (
          <ErrorAlert type="error" header="Couldn't open Stripe">
            {apiErrorMessage(error)}
          </ErrorAlert>
        ) : null}
      </CardContent>
    </Card>
  );
}
