/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Card, CardContent } from '@discava/common-shadcn/components/ui/card';

export interface Totals {
  enrolments: number;
  active: number;
  completed: number;
  dropped: number;
  completionRate: number | null;
  activeThisWeek: number;
}

// The course's all-time figures, one card each.
export function TotalsRow({ totals }: { totals: Totals }) {
  const figures: [string, number | string][] = [
    ['Enrolments', totals.enrolments],
    ['Active', totals.active],
    ['Completed', totals.completed],
    ['Dropped', totals.dropped],
    [
      'Completion rate',
      totals.completionRate === null ? 'No data' : `${totals.completionRate}%`,
    ],
    ['Active this week', totals.activeThisWeek],
  ];
  return (
    <dl
      className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6"
      aria-label="Totals"
    >
      {figures.map(([label, value]) => (
        <Card key={label} className="py-4">
          <CardContent className="px-5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums">{value}</dd>
          </CardContent>
        </Card>
      ))}
    </dl>
  );
}
