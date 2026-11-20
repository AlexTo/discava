/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Wallet } from 'lucide-react';
import { useState } from 'react';
import { useInstructorApi } from '../../../api';
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

export const Route = createFileRoute('/_authenticated/earnings')({
  component: RouteComponent,
});

function RouteComponent() {
  const trpc = useInstructorApi();
  const overview = useQuery(trpc.payout.overview.queryOptions());
  const [month, setMonth] = useState(currentUtcMonth);
  const [period, setPeriod] = useState<Period>(() => monthPeriod(month));

  return (
    <main className="w-full space-y-6 pb-8">
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
          onMonthChange={(next) => {
            setMonth(next);
            setPeriod(monthPeriod(next));
          }}
          onPeriodChange={setPeriod}
        />
        <ReportSection period={period} />
      </section>

      <PayoutsList overview={overview} />
    </main>
  );
}
