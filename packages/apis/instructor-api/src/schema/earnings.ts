/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

// The earnings report (specs/20261116-013137-instructor-payouts/contracts/
// instructor-api-earnings.md). Amounts are integers in minor units, and no
// output carries a buyer's ID, email or name.

export const EARNINGS_MAX_DAYS = 366;

export const EARNINGS_RANGE_MESSAGE = `Choose a period of at most ${EARNINGS_MAX_DAYS} days that ends after it starts`;

const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value),
    {
      message: 'Enter a real date as YYYY-MM-DD',
    },
  );

export const EarningsPeriodInputSchema = z.object({
  from: DateSchema,
  to: DateSchema,
});

export type IEarningsPeriodInput = z.output<typeof EarningsPeriodInputSchema>;

export const EarningsFiguresSchema = z.object({
  orders: z.number(),
  grossMinor: z.number(),
  discountMinor: z.number(),
  refundMinor: z.number(),
  feeMinor: z.number(),
  netMinor: z.number(),
});

export type IEarningsFigures = z.output<typeof EarningsFiguresSchema>;

export const EarningsCourseRowSchema = EarningsFiguresSchema.extend({
  courseId: z.string(),
  courseTitle: z.string(),
});

export type IEarningsCourseRow = z.output<typeof EarningsCourseRowSchema>;

export const EarningsReportOutputSchema = z.object({
  currencies: z.array(
    z.object({
      currency: z.string(),
      courses: z.array(EarningsCourseRowSchema),
      totals: EarningsFiguresSchema,
    }),
  ),
});

export type IEarningsReportOutput = z.output<typeof EarningsReportOutputSchema>;

export const EarningsLinesInputSchema = EarningsPeriodInputSchema.extend({
  courseId: z.string().min(1),
  cursor: z.string().min(1).optional(),
});

export type IEarningsLinesInput = z.output<typeof EarningsLinesInputSchema>;

export const EarningsLineSchema = z.object({
  entryId: z.string(),
  kind: z.enum(['sale', 'refund']),
  orderId: z.string(),
  occurredAt: z.string(),
  currency: z.string(),
  grossMinor: z.number(),
  discountMinor: z.number(),
  refundMinor: z.number(),
  feeMinor: z.number(),
  netMinor: z.number(),
});

export type IEarningsLine = z.output<typeof EarningsLineSchema>;

export const EarningsLinesOutputSchema = z.object({
  lines: z.array(EarningsLineSchema),
  nextCursor: z.string().optional(),
});

export type IEarningsLinesOutput = z.output<typeof EarningsLinesOutputSchema>;
