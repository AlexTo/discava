/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type EarningDayRecord,
  queryEarningDays,
  queryEarningLines,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import {
  EARNINGS_MAX_DAYS,
  EARNINGS_RANGE_MESSAGE,
  EarningsLinesInputSchema,
  EarningsLinesOutputSchema,
  EarningsPeriodInputSchema,
  EarningsReportOutputSchema,
  type IEarningsCourseRow,
  type IEarningsFigures,
  type IEarningsLine,
} from '../schema/index.js';

const LINES_PAGE_SIZE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

// `to` must not be before `from`, and the period spans at most 366 days (both
// ends count).
const requireValidPeriod = (from: string, to: string) => {
  const days =
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      DAY_MS +
    1;
  if (days < 1 || days > EARNINGS_MAX_DAYS) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: EARNINGS_RANGE_MESSAGE,
    });
  }
};

const emptyFigures = (): IEarningsFigures => ({
  orders: 0,
  grossMinor: 0,
  discountMinor: 0,
  refundMinor: 0,
  feeMinor: 0,
  netMinor: 0,
});

const addDay = (figures: IEarningsFigures, day: EarningDayRecord) => {
  figures.orders += day.salesCount ?? 0;
  figures.grossMinor += day.grossMinor ?? 0;
  figures.discountMinor += day.discountMinor ?? 0;
  figures.refundMinor += day.refundMinor ?? 0;
  figures.feeMinor += day.feeMinor ?? 0;
  figures.netMinor += day.netMinor ?? 0;
};

export const report = courseProcedure
  .input(EarningsPeriodInputSchema)
  .output(EarningsReportOutputSchema)
  .query(async ({ ctx, input }) => {
    requireValidPeriod(input.from, input.to);
    const days = await queryEarningDays({
      coreTable: ctx.coreTable,
      instructorId: ctx.user.sub,
      from: input.from,
      to: input.to,
    });

    // Currency, then course, in first-seen order of the sorted day rows.
    const byCurrency = new Map<string, Map<string, IEarningsFigures>>();
    for (const day of days) {
      const courses = byCurrency.get(day.currency) ?? new Map();
      const figures = courses.get(day.courseId) ?? emptyFigures();
      addDay(figures, day);
      courses.set(day.courseId, figures);
      byCurrency.set(day.currency, courses);
    }

    const courseIds = [
      ...new Set([...byCurrency.values()].flatMap((m) => [...m.keys()])),
    ];
    const titles = new Map(
      await Promise.all(
        courseIds.map(async (courseId) => {
          const { data } = await ctx.coreTable.entities.course
            .get({ courseId })
            .go();
          return [courseId, data?.title ?? ''] as const;
        }),
      ),
    );

    return {
      currencies: [...byCurrency.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([currency, courses]) => {
          const rows: IEarningsCourseRow[] = [...courses.entries()].map(
            ([courseId, figures]) => ({
              courseId,
              courseTitle: titles.get(courseId) ?? '',
              ...figures,
            }),
          );
          const totals = emptyFigures();
          for (const row of rows) {
            for (const key of Object.keys(
              totals,
            ) as (keyof IEarningsFigures)[]) {
              totals[key] += row[key];
            }
          }
          return { currency, courses: rows, totals };
        }),
    };
  });

export const lines = courseProcedure
  .input(EarningsLinesInputSchema)
  .output(EarningsLinesOutputSchema)
  .query(async ({ ctx, input }) => {
    requireValidPeriod(input.from, input.to);
    // The query stays inside the caller's own partition, so a course they
    // have no entries for returns an empty page.
    const page = await queryEarningLines({
      coreTable: ctx.coreTable,
      instructorId: ctx.user.sub,
      courseId: input.courseId,
      from: input.from,
      to: input.to,
      cursor: input.cursor,
      limit: LINES_PAGE_SIZE,
    });
    // Built key by key, so nothing else on the record can reach the caller.
    const items: IEarningsLine[] = page.lines.map((line) => ({
      entryId: line.entryId,
      kind: line.kind,
      orderId: line.orderId,
      occurredAt: line.occurredAt,
      currency: line.currency,
      grossMinor: line.grossMinor,
      discountMinor: line.discountMinor,
      refundMinor: line.refundMinor,
      feeMinor: line.feeMinor,
      netMinor: line.netMinor,
    }));
    return {
      lines: items,
      ...(page.cursor !== null && { nextCursor: page.cursor }),
    };
  });
