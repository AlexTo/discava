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
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@discava/common-shadcn/components/ui/chart';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

export interface Day {
  date: string;
  enrolments: number;
  activeLearners: number;
}

const shortDate = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

const formatDate = (date: string) => shortDate.format(new Date(date));

// One bar per UTC day of `field`, with the same figures as a table for
// assistive technology, which the bars alone don't give.
export function DailyChart({
  title,
  field,
  label,
  days,
}: {
  title: string;
  field: 'enrolments' | 'activeLearners';
  label: string;
  days: Day[];
}) {
  const config = {
    [field]: { label, color: 'var(--chart-1)' },
  } satisfies ChartConfig;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base" role="heading" aria-level={2}>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={config}
          className="aspect-auto h-56 w-full"
          aria-hidden="true"
        >
          <BarChart data={days} accessibilityLayer={false}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              minTickGap={24}
              tickFormatter={formatDate}
            />
            <YAxis allowDecimals={false} width={32} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(label) => formatDate(String(label))}
                />
              }
            />
            <Bar dataKey={field} fill={`var(--color-${field})`} radius={2} />
          </BarChart>
        </ChartContainer>
        <table className="sr-only">
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">{label}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <th scope="row">{day.date}</th>
                <td>{day[field]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
