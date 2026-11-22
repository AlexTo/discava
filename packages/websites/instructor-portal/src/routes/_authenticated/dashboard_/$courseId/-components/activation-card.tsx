/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@discava/common-shadcn/components/ui/card';

export interface ActivationTotals {
  enrolments: number;
  activated: number;
  activationRate: number | null;
  promptAnswered: number;
  promptDismissed: number;
}

export interface ActivationDay {
  enrolments: number;
  activated: number;
}

const startedLine = (
  activated: number,
  enrolments: number,
  rate: number | null,
) =>
  enrolments === 0 || rate === null
    ? 'No data'
    : `${activated} of ${enrolments} enrolled learners have started (${rate}%)`;

// How many enrolled learners have done a first thing, all time and over the
// page's selected range, and what they did with the first-lesson prompt.
export function ActivationCard({
  totals,
  daily,
  days,
}: {
  totals: ActivationTotals;
  daily: ActivationDay[];
  days: number;
}) {
  const rangeEnrolments = daily.reduce((sum, day) => sum + day.enrolments, 0);
  const rangeActivated = daily.reduce((sum, day) => sum + day.activated, 0);
  const rangeRate =
    rangeEnrolments > 0
      ? Math.floor((rangeActivated * 100) / rangeEnrolments)
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base" role="heading" aria-level={2}>
          Activation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="font-medium">
          {startedLine(
            totals.activated,
            totals.enrolments,
            totals.activationRate,
          )}
        </p>
        <p>
          Last {days} days:{' '}
          {startedLine(rangeActivated, rangeEnrolments, rangeRate)}
        </p>
        <p>
          {totals.promptAnswered} answered the first-lesson prompt,{' '}
          {totals.promptDismissed} dismissed it
        </p>
        <p className="text-muted-foreground">
          Started means completed an item or submitted a quiz attempt. Recent
          learners may still start, so these are figures so far.
        </p>
      </CardContent>
    </Card>
  );
}
