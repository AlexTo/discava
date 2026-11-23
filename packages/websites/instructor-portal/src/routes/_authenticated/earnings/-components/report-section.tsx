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
import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { useInstructorApi } from '../../../../api';
import { CourseLines } from './course-lines';
import { formatMoney } from './money';
import type { Period } from './period';

const COLUMNS = 7;

/** The report for a period: a table per currency, a row per course. */
export function ReportSection({ period }: { period: Period }) {
  const trpc = useInstructorApi();
  const query = useQuery(trpc.earnings.report.queryOptions(period));
  const [open, setOpen] = useState<Set<string>>(new Set());

  if (query.isPending) {
    return (
      <Skeleton
        data-testid="report-skeleton"
        className="h-40 w-full rounded-xl"
      />
    );
  }
  if (query.isError) {
    return (
      <ErrorAlert
        type="error"
        header="Couldn't load the report"
        onRetry={() => void query.refetch()}
      >
        {apiErrorMessage(query.error)}
      </ErrorAlert>
    );
  }
  if (query.data.currencies.length === 0) {
    return (
      <Card className="border-dashed py-10 text-center">
        <CardContent className="text-sm text-muted-foreground">
          No sales in this period
        </CardContent>
      </Card>
    );
  }

  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="space-y-4">
      {query.data.currencies.map(({ currency, courses, totals }) => {
        const money = (amount: number) => formatMoney(amount, currency);
        return (
          <Card key={currency} className="gap-4">
            <CardHeader>
              <CardTitle className="text-base">{currency}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table
                aria-label={`Earnings in ${currency}`}
                className="w-full text-left text-sm"
              >
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">Course</th>
                    <th className="whitespace-nowrap px-2 py-2 text-right font-medium">
                      Orders
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 text-right font-medium">
                      Gross
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 text-right font-medium">
                      Discounts
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 text-right font-medium">
                      Refunds
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 text-right font-medium">
                      Platform fee
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 text-right font-medium">
                      Net
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {courses.map((course) => {
                    const key = `${currency}#${course.courseId}`;
                    return (
                      <Fragment key={key}>
                        <tr className="border-b">
                          <td className="px-2 py-2">
                            <div className="font-medium">
                              {course.courseTitle}
                            </div>
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              className="h-auto p-0"
                              aria-expanded={open.has(key)}
                              onClick={() => toggle(key)}
                            >
                              {open.has(key) ? 'Hide orders' : 'Show orders'}
                            </Button>
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                            {course.orders}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                            {money(course.grossMinor)}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                            {money(course.discountMinor)}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                            {money(course.refundMinor)}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                            {money(course.feeMinor)}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                            {money(course.netMinor)}
                          </td>
                        </tr>
                        {open.has(key) ? (
                          <tr className="border-b">
                            <td colSpan={COLUMNS} className="py-3">
                              <CourseLines
                                courseId={course.courseId}
                                period={period}
                              />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="px-2 py-2">Total</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                      {totals.orders}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                      {money(totals.grossMinor)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                      {money(totals.discountMinor)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                      {money(totals.refundMinor)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                      {money(totals.feeMinor)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                      {money(totals.netMinor)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
