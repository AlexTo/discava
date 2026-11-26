/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { lines, report } from './earnings.js';

const { queryEarningDays, queryEarningLines, courseGet, mockModule } =
  await vi.hoisted(async () => ({
    queryEarningDays: vi.fn(),
    queryEarningLines: vi.fn(),
    ...(
      await import('@discava/common-server-utils/trpc-testing')
    ).mockCoreTable({ course: ['get'] }),
  }));

vi.mock('@discava/core-table', async (importActual) =>
  mockModule(await importActual(), { queryEarningDays, queryEarningLines }),
);

const router = t.router({ report, lines });

const INSTRUCTOR_SUB = 'instructor-1';

const callAs = (groups: string[] = ['instructor']) =>
  callerFor(router, { sub: INSTRUCTOR_SUB, groups });

const period = { from: '2026-01-01', to: '2026-12-31' };

interface Entry {
  entryId: string;
  kind: 'sale' | 'refund';
  orderId: string;
  courseId: string;
  currency: string;
  day: string;
  grossMinor: number;
  discountMinor: number;
  refundMinor: number;
  feeMinor: number;
}

const net = (
  e: Pick<Entry, 'grossMinor' | 'discountMinor' | 'refundMinor' | 'feeMinor'>,
) => e.grossMinor - e.discountMinor - e.refundMinor - e.feeMinor;

// A small deterministic generator, so a failure reproduces.
const random = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const generateEntries = (): Entry[] => {
  const next = random(7);
  const out: Entry[] = [];
  const currencies = ['USD', 'EUR'];
  for (let i = 0; i < 60; i++) {
    const gross = 1000 + Math.floor(next() * 9000);
    const discount = Math.floor(next() * 500);
    const fee = Math.floor(((gross - discount) * 2000) / 10000);
    const day = `2026-0${1 + Math.floor(next() * 9)}-1${Math.floor(next() * 9)}`;
    const base = {
      courseId: `course-${i % 3}`,
      currency: currencies[i % 2]!,
      day,
    };
    out.push({
      ...base,
      entryId: `sale-${i}`,
      kind: 'sale',
      orderId: `order-${i}`,
      grossMinor: gross,
      discountMinor: discount,
      refundMinor: 0,
      feeMinor: fee,
    });
    if (i % 4 === 0) {
      const refund = Math.floor((gross - discount) / 2);
      out.push({
        ...base,
        entryId: `refund-${i}`,
        kind: 'refund',
        orderId: `order-${i}`,
        grossMinor: 0,
        discountMinor: 0,
        refundMinor: refund,
        feeMinor: -Math.floor((refund * 2000) / 10000),
      });
    }
  }
  return out;
};

// The day rows a ledger of entries adds up to.
const dayRows = (entries: Entry[]) => {
  const rows = new Map<string, Record<string, any>>();
  for (const e of entries) {
    const key = `${e.day}|${e.courseId}|${e.currency}`;
    const row = rows.get(key) ?? {
      instructorId: INSTRUCTOR_SUB,
      day: e.day,
      courseId: e.courseId,
      currency: e.currency,
      salesCount: 0,
      grossMinor: 0,
      discountMinor: 0,
      refundMinor: 0,
      feeMinor: 0,
      netMinor: 0,
    };
    row.salesCount += e.kind === 'sale' ? 1 : 0;
    row.grossMinor += e.grossMinor;
    row.discountMinor += e.discountMinor;
    row.refundMinor += e.refundMinor;
    row.feeMinor += e.feeMinor;
    row.netMinor += net(e);
    rows.set(key, row);
  }
  return [...rows.values()];
};

const figureKeys = [
  'orders',
  'grossMinor',
  'discountMinor',
  'refundMinor',
  'feeMinor',
  'netMinor',
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  courseGet.mockImplementation(({ courseId }: { courseId: string }) => ({
    go: async () => ({ data: { courseId, title: `Title of ${courseId}` } }),
  }));
});

describe('earnings.report', () => {
  it('refuses a caller outside the instructor group', async () => {
    await expect(callAs(['student']).report(period)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      callAs(['student']).lines({ ...period, courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(queryEarningDays).not.toHaveBeenCalled();
  });

  it("reads only the caller's own partition", async () => {
    queryEarningDays.mockResolvedValue([]);
    await callAs().report(period);
    expect(queryEarningDays).toHaveBeenCalledTimes(1);
    expect(queryEarningDays).toHaveBeenCalledWith(
      expect.objectContaining({ instructorId: INSTRUCTOR_SUB, ...period }),
    );
  });

  it('returns no currencies for an instructor with no earnings', async () => {
    queryEarningDays.mockResolvedValue([]);
    expect(await callAs().report(period)).toEqual({ currencies: [] });
  });

  it.each([
    ['to before from', { from: '2026-02-01', to: '2026-01-31' }],
    ['more than 366 days', { from: '2026-01-01', to: '2027-01-02' }],
  ])('refuses a period with %s', async (_name, input) => {
    await expect(callAs().report(input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Choose a period of at most 366 days that ends after it starts',
    });
    await expect(
      callAs().lines({ ...input, courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(queryEarningDays).not.toHaveBeenCalled();
  });

  it('accepts exactly 366 days and a single day', async () => {
    queryEarningDays.mockResolvedValue([]);
    await callAs().report({ from: '2028-01-01', to: '2028-12-31' });
    await callAs().report({ from: '2026-05-05', to: '2026-05-05' });
    expect(queryEarningDays).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a day that does not exist', '2026-02-30'],
    ['a month that does not exist', '2026-13-01'],
  ])('refuses %s with the schema message', async (_name, bad) => {
    await expect(
      callAs().report({ from: bad, to: '2026-03-01' }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('Enter a real date as YYYY-MM-DD'),
    });
    await expect(
      callAs().report({ from: '2026-01-01', to: bad }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.not.stringContaining('Invalid time value'),
    });
  });

  it('never sums two currencies together', async () => {
    queryEarningDays.mockResolvedValue(
      dayRows([
        {
          entryId: 's1',
          kind: 'sale',
          orderId: 'o1',
          courseId: 'course-1',
          currency: 'USD',
          day: '2026-03-01',
          grossMinor: 1000,
          discountMinor: 0,
          refundMinor: 0,
          feeMinor: 200,
        },
        {
          entryId: 's2',
          kind: 'sale',
          orderId: 'o2',
          courseId: 'course-1',
          currency: 'EUR',
          day: '2026-03-01',
          grossMinor: 500,
          discountMinor: 0,
          refundMinor: 0,
          feeMinor: 100,
        },
      ]),
    );
    const { currencies } = await callAs().report(period);
    expect(currencies.map((c) => [c.currency, c.totals.netMinor])).toEqual([
      ['EUR', 400],
      ['USD', 800],
    ]);
    expect(currencies.every((c) => c.courses.length === 1)).toBe(true);
  });

  it('groups by course, titles them from the courses and satisfies the identity everywhere', async () => {
    const entries = generateEntries();
    queryEarningDays.mockResolvedValue(dayRows(entries));
    const { currencies } = await callAs().report(period);

    expect(currencies.map((c) => c.currency)).toEqual(['EUR', 'USD']);
    for (const { courses, totals } of currencies) {
      for (const row of [...courses, totals]) {
        expect(
          row.grossMinor - row.discountMinor - row.refundMinor - row.feeMinor,
        ).toBe(row.netMinor);
      }
      for (const key of figureKeys) {
        expect(totals[key]).toBe(courses.reduce((n, c) => n + c[key], 0));
      }
      for (const course of courses) {
        expect(course.courseTitle).toBe(`Title of ${course.courseId}`);
      }
    }
    const all = currencies.flatMap((c) => c.courses);
    expect(all.reduce((n, c) => n + c.netMinor, 0)).toBe(
      entries.reduce((n, e) => n + net(e), 0),
    );
  });

  it.each([10, 10_000])(
    'makes one day query for a year at %i orders a day',
    async (perDay) => {
      const rows = Array.from({ length: 365 }, (_, i) => ({
        instructorId: INSTRUCTOR_SUB,
        day: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
        courseId: 'course-1',
        currency: 'USD',
        salesCount: perDay,
        grossMinor: perDay * 1000,
        discountMinor: 0,
        refundMinor: 0,
        feeMinor: perDay * 200,
        netMinor: perDay * 800,
      }));
      queryEarningDays.mockResolvedValue(rows);
      const { currencies } = await callAs().report(period);
      expect(queryEarningDays).toHaveBeenCalledTimes(1);
      expect(queryEarningLines).not.toHaveBeenCalled();
      expect(currencies[0]!.courses).toHaveLength(1);
      expect(currencies[0]!.totals.orders).toBe(perDay * 365);
    },
  );

  it("exposes no buyer identity: only the contract's keys leave", async () => {
    queryEarningDays.mockResolvedValue(
      dayRows(generateEntries()).map((row) => ({
        ...row,
        userId: 'buyer-1',
        email: 'buyer@example.com',
      })),
    );
    const { currencies } = await callAs().report(period);
    const figures = [...figureKeys].sort();
    expect(Object.keys(currencies[0]!).sort()).toEqual([
      'courses',
      'currency',
      'totals',
    ]);
    expect(Object.keys(currencies[0]!.totals).sort()).toEqual(figures);
    expect(Object.keys(currencies[0]!.courses[0]!).sort()).toEqual(
      [...figures, 'courseId', 'courseTitle'].sort(),
    );
  });

  it('nets a sale in one period and its refund in a later one to zero', async () => {
    const sale: Entry = {
      entryId: 'sale-1',
      kind: 'sale',
      orderId: 'o1',
      courseId: 'course-1',
      currency: 'USD',
      day: '2026-01-31',
      grossMinor: 1000,
      discountMinor: 200,
      refundMinor: 0,
      feeMinor: 160,
    };
    const refund: Entry = {
      ...sale,
      entryId: 'refund-1',
      kind: 'refund',
      day: '2026-02-01',
      grossMinor: 0,
      discountMinor: 0,
      refundMinor: 800,
      feeMinor: -160,
    };
    queryEarningDays.mockResolvedValueOnce(dayRows([sale]));
    queryEarningDays.mockResolvedValueOnce(dayRows([refund]));
    const january = await callAs().report({
      from: '2026-01-01',
      to: '2026-01-31',
    });
    const february = await callAs().report({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(january.currencies[0]!.totals.netMinor).toBe(640);
    expect(february.currencies[0]!.totals.netMinor).toBe(-640);
    expect(
      january.currencies[0]!.totals.netMinor +
        february.currencies[0]!.totals.netMinor,
    ).toBe(0);
  });
});

describe('earnings.lines', () => {
  const all = generateEntries().filter((e) => e.courseId === 'course-1');
  const stored = all.map((e) => ({
    ...e,
    instructorId: INSTRUCTOR_SUB,
    userId: 'buyer-1',
    occurredAt: `${e.day}T10:00:00.000Z`,
    netMinor: net(e),
    payoutId: 'payout-1',
  }));

  // Pages `stored` the way the helper does: a limit and an opaque cursor.
  const page = async ({
    cursor,
    limit,
  }: {
    cursor?: string;
    limit: number;
  }) => {
    const start = cursor ? Number(cursor) : 0;
    const end = start + limit;
    return {
      lines: stored.slice(start, end),
      cursor: end < stored.length ? String(end) : null,
    };
  };

  it('pages 50 at a time and the pages sum to the course row', async () => {
    expect(stored.length).toBeGreaterThan(0);
    queryEarningLines.mockImplementation(async (args) => page(args));
    queryEarningDays.mockResolvedValue(dayRows(all));

    const seen: any[] = [];
    let cursor: string | undefined;
    do {
      const result = await callAs().lines({
        ...period,
        courseId: 'course-1',
        cursor,
      });
      expect(result.lines.length).toBeLessThanOrEqual(50);
      seen.push(...result.lines);
      cursor = result.nextCursor;
    } while (cursor);

    expect(queryEarningLines).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50, instructorId: INSTRUCTOR_SUB }),
    );
    const { currencies } = await callAs().report(period);
    // A course here has lines in two currencies; each currency's row is the
    // sum of that currency's lines.
    for (const { currency, courses } of currencies) {
      const row = courses.find((c) => c.courseId === 'course-1')!;
      const mine = seen.filter((l) => l.currency === currency);
      expect(mine.reduce((n, l) => n + l.netMinor, 0)).toBe(row.netMinor);
      expect(mine.reduce((n, l) => n + l.grossMinor, 0)).toBe(row.grossMinor);
      expect(mine.reduce((n, l) => n + l.refundMinor, 0)).toBe(row.refundMinor);
      expect(mine.reduce((n, l) => n + l.feeMinor, 0)).toBe(row.feeMinor);
    }
    expect(seen).toHaveLength(stored.length);
  });

  it('returns an empty page for a course the instructor has no entries for', async () => {
    queryEarningLines.mockResolvedValue({ lines: [], cursor: null });
    expect(
      await callAs().lines({ ...period, courseId: 'someone-elses' }),
    ).toEqual({ lines: [] });
  });

  it("exposes no buyer identity: only the contract's keys leave", async () => {
    queryEarningLines.mockResolvedValue({
      lines: stored.slice(0, 2),
      cursor: null,
    });
    const result = await callAs().lines({ ...period, courseId: 'course-1' });
    for (const line of result.lines) {
      expect(Object.keys(line).sort()).toEqual(
        [
          'currency',
          'discountMinor',
          'entryId',
          'feeMinor',
          'grossMinor',
          'kind',
          'netMinor',
          'occurredAt',
          'orderId',
          'refundMinor',
        ].sort(),
      );
    }
  });
});
