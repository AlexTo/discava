/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Wallet } from 'lucide-react';
import { useState } from 'react';
import { useInstructorApi } from '../../../api';
import { correctSearch } from '../../../lib/canonical-search';
import { BalanceCard } from './-components/balance-card';
import { PayoutAccountCard } from './-components/payout-account-card';
import { PayoutsList } from './-components/payouts-list';
import {
  currentUtcMonth,
  monthPeriod,
  type Period,
} from './-components/period';
import { PeriodPicker } from './-components/period-picker';
import { ReportSection } from './-components/report-section';

const isMonth = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

const isDay = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

// The period is kept in the URL so it survives a reload and can be shared:
// a month, or a range of days that wins over it. Neither is the current month.
export const Route = createFileRoute('/_authenticated/earnings')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { month?: string; from?: string; to?: string } => {
    if (isDay(search.from) && isDay(search.to) && search.from <= search.to) {
      return { from: search.from, to: search.to };
    }
    return isMonth(search.month) ? { month: search.month } : {};
  },
  // An invalid value in the address is replaced by the one it fell back to.
  beforeLoad: ({ search, location }) =>
    correctSearch(location.search, {
      month: search.month,
      from: search.from,
      to: search.to,
    }),
  component: RouteComponent,
});

function RouteComponent() {
  usePageTitle('Earnings');
  const trpc = useInstructorApi();
  const overview = useQuery(trpc.payout.overview.queryOptions());
  const { month: searchMonth, from, to } = Route.useSearch();
  const navigate = Route.useNavigate();
  const month = searchMonth ?? currentUtcMonth();
  const addressRange = from && to ? { from, to } : undefined;
  // A range the address can't hold (it ends before it starts) is still asked
  // for, so the API can say why it isn't one.
  const [rejected, setRejected] = useState<Period>();
  const period = rejected ?? addressRange ?? monthPeriod(month);

  return (
    <div className="w-full space-y-6 pb-8">
      <section>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
          <Wallet className="size-4" /> Money
        </div>
        <h1 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
          Earnings
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          What your courses earned, and what has been paid out.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <PayoutAccountCard />
        <BalanceCard overview={overview} />
      </div>

      <section className="space-y-4" aria-label="Report">
        <h2 className="text-lg font-semibold">Report</h2>
        <PeriodPicker
          month={month}
          range={addressRange}
          onMonthChange={(next) => {
            setRejected(undefined);
            void navigate({
              search: { month: next === currentUtcMonth() ? undefined : next },
            });
          }}
          onPeriodChange={(next) => {
            if (next.from > next.to) {
              setRejected(next);
              return;
            }
            setRejected(undefined);
            void navigate({ search: next });
          }}
        />
        <ReportSection period={period} />
      </section>

      <PayoutsList overview={overview} />
    </div>
  );
}
