/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Period {
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The current month in UTC as "YYYY-MM", the value of a month input. */
export const currentUtcMonth = (now: Date = new Date()): string =>
  `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`;

/** The first and last day (UTC, inclusive) of a "YYYY-MM" month. */
export const monthPeriod = (month: string): Period => {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
};
