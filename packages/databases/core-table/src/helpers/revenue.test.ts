/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  calculateFee,
  calculateRefund,
  calculateSale,
  splitAmount,
} from './revenue.js';

const IDS = ['a', 'b', 'c', 'd', 'e'];
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Every way of reaching `paid` in `steps` rising refunded totals. */
const totalsInSteps = (paid: number, steps: number): number[][] => {
  if (steps === 1) return [[paid]];
  const out: number[][] = [];
  const build = (prefix: number[]) => {
    if (prefix.length === steps - 1) {
      out.push([...prefix, paid]);
      return;
    }
    const last = prefix[prefix.length - 1] ?? 0;
    for (let next = last + 1; next < paid; next++) build([...prefix, next]);
  };
  build([]);
  return out;
};

describe('calculateFee', () => {
  it('rounds half up in integer arithmetic', () => {
    expect(calculateFee(1, 5000)).toBe(1);
    expect(calculateFee(2, 5000)).toBe(1);
    expect(calculateFee(3, 5000)).toBe(2);
    expect(calculateFee(10, 1500)).toBe(2);
    expect(calculateFee(9, 1500)).toBe(1);
    expect(calculateFee(1000, 2000)).toBe(200);
  });

  it('takes nothing at 0 and everything at 10000 basis points', () => {
    expect(calculateFee(12345, 0)).toBe(0);
    expect(calculateFee(12345, 10000)).toBe(12345);
  });

  it('rejects non-integers and out-of-range values', () => {
    expect(() => calculateFee(1.5, 2000)).toThrow();
    expect(() => calculateFee(100, 20.5)).toThrow();
    expect(() => calculateFee(100, 10001)).toThrow();
    expect(() => calculateFee(100, -1)).toThrow();
    expect(() => calculateFee(-1, 2000)).toThrow();
    expect(() => calculateFee(Number.NaN, 2000)).toThrow();
  });
});

describe('splitAmount', () => {
  it('gives the remainder one unit each to the first instructors by ID', () => {
    expect(splitAmount(10, ['c', 'a', 'b'])).toEqual([
      { instructorId: 'a', amountMinor: 4 },
      { instructorId: 'b', amountMinor: 3 },
      { instructorId: 'c', amountMinor: 3 },
    ]);
  });

  it('adds up to the whole for 1 to 5 instructors and awkward remainders', () => {
    for (let n = 1; n <= 5; n++) {
      for (const amount of [0, 1, 2, 3, 7, 99, 100, 101, 9999, 1000003]) {
        const shares = splitAmount(amount, IDS.slice(0, n));
        expect(sum(shares.map((s) => s.amountMinor))).toBe(amount);
        const values = shares.map((s) => s.amountMinor);
        expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(
          1,
        );
      }
    }
  });

  it('rejects non-integers, no instructors and duplicates', () => {
    expect(() => splitAmount(1.5, IDS)).toThrow();
    expect(() => splitAmount(10, [])).toThrow();
    expect(() => splitAmount(10, ['a', 'a'])).toThrow();
  });
});

describe('calculateSale', () => {
  it('splits a single instructor sale into fee and net', () => {
    expect(
      calculateSale({
        grossMinor: 1000,
        paidMinor: 800,
        feeBasisPoints: 2000,
        instructorIds: ['a'],
      }),
    ).toEqual([
      {
        instructorId: 'a',
        grossMinor: 1000,
        discountMinor: 200,
        feeMinor: 160,
        netMinor: 640,
      },
    ]);
  });

  it('keeps fee plus instructor amounts equal to the amount paid', () => {
    for (let paid = 0; paid <= 400; paid += 7) {
      for (const bp of [0, 1, 333, 1500, 2000, 5000, 9999, 10000]) {
        for (let n = 1; n <= 5; n++) {
          const result = calculateSale({
            grossMinor: paid + 13,
            paidMinor: paid,
            feeBasisPoints: bp,
            instructorIds: IDS.slice(0, n),
          });
          expect(sum(result.map((r) => r.feeMinor))).toBe(
            calculateFee(paid, bp),
          );
          expect(
            sum(result.map((r) => r.feeMinor)) +
              sum(result.map((r) => r.netMinor)),
          ).toBe(paid);
        }
      }
    }
  });

  it('shares the whole, and gross - discount - fee = net per instructor', () => {
    for (let n = 1; n <= 5; n++) {
      for (const [gross, paid] of [
        [100, 99],
        [101, 50],
        [1, 1],
        [7, 3],
        [1000, 1],
      ]) {
        const result = calculateSale({
          grossMinor: gross,
          paidMinor: paid,
          feeBasisPoints: 2000,
          instructorIds: IDS.slice(0, n),
        });
        expect(sum(result.map((r) => r.grossMinor))).toBe(gross);
        expect(sum(result.map((r) => r.discountMinor))).toBe(gross - paid);
        for (const r of result) {
          expect(r.grossMinor - r.discountMinor - r.feeMinor).toBe(r.netMinor);
          expect(r.discountMinor).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('gives zeros for a 100% discount', () => {
    const result = calculateSale({
      grossMinor: 500,
      paidMinor: 0,
      feeBasisPoints: 2000,
      instructorIds: ['a', 'b'],
    });
    expect(result.map((r) => r.feeMinor)).toEqual([0, 0]);
    expect(result.map((r) => r.netMinor)).toEqual([0, 0]);
    expect(sum(result.map((r) => r.discountMinor))).toBe(500);
  });

  it('rejects non-integers and a price above the list price', () => {
    const base = {
      grossMinor: 100,
      paidMinor: 100,
      feeBasisPoints: 2000,
      instructorIds: ['a'],
    };
    expect(() => calculateSale({ ...base, grossMinor: 99.5 })).toThrow();
    expect(() => calculateSale({ ...base, paidMinor: 0.5 })).toThrow();
    expect(() => calculateSale({ ...base, feeBasisPoints: 1999.5 })).toThrow();
    expect(() => calculateSale({ ...base, paidMinor: 101 })).toThrow();
  });
});

describe('calculateRefund', () => {
  const sale = {
    grossMinor: 100,
    paidMinor: 99,
    feeBasisPoints: 2000,
    instructorIds: ['a', 'b'],
  };

  it('returns exactly the sale on a full refund in one step', () => {
    const soldTo = calculateSale(sale);
    const refunds = calculateRefund({
      ...sale,
      recordedRefundedMinor: 0,
      refundedTotalMinor: 99,
    });
    // The case that breaks a discount-first split: paid shares are 50 and 49
    // on the sale and on the refund.
    expect(refunds.map((r) => r.refundMinor)).toEqual([50, 49]);
    for (const refund of refunds) {
      const own = soldTo.find((s) => s.instructorId === refund.instructorId);
      expect(refund.feeMinor).toBe(0 - (own?.feeMinor ?? NaN));
      expect(refund.netMinor).toBe(0 - (own?.netMinor ?? NaN));
    }
  });

  it('returns nothing for a total at or below the recorded one', () => {
    expect(
      calculateRefund({
        ...sale,
        recordedRefundedMinor: 40,
        refundedTotalMinor: 40,
      }),
    ).toEqual([]);
    expect(
      calculateRefund({
        ...sale,
        recordedRefundedMinor: 40,
        refundedTotalMinor: 10,
      }),
    ).toEqual([]);
  });

  it('caps a total over the amount paid', () => {
    expect(
      calculateRefund({
        ...sale,
        recordedRefundedMinor: 0,
        refundedTotalMinor: 5000,
      }),
    ).toEqual(
      calculateRefund({
        ...sale,
        recordedRefundedMinor: 0,
        refundedTotalMinor: 99,
      }),
    );
    expect(
      calculateRefund({
        ...sale,
        recordedRefundedMinor: 99,
        refundedTotalMinor: 5000,
      }),
    ).toEqual([]);
  });

  it('returns the whole sale however the refund is cut into steps', () => {
    for (const [gross, paid, bp, n] of [
      [100, 99, 2000, 2],
      [30, 30, 2000, 3],
      [10, 7, 1500, 3],
      [9, 9, 5000, 2],
      [8, 5, 3333, 4],
      [2, 2, 5000, 1],
      [11, 11, 10000, 3],
      [11, 11, 0, 3],
    ]) {
      const input = {
        grossMinor: gross,
        paidMinor: paid,
        feeBasisPoints: bp,
        instructorIds: IDS.slice(0, n),
      };
      const soldTo = calculateSale(input);
      // Large prices only in up to two steps: the number of ways grows fast.
      for (const steps of paid > 12 ? [1, 2] : [1, 2, 3, 4]) {
        for (const totals of totalsInSteps(paid, steps)) {
          const refundTotal = new Map<string, number>();
          const feeTotal = new Map<string, number>();
          const netTotal = new Map<string, number>();
          let recorded = 0;
          let feeReturned = 0;
          for (const total of totals) {
            const refunds = calculateRefund({
              ...input,
              recordedRefundedMinor: recorded,
              refundedTotalMinor: total,
            });
            for (const r of refunds) {
              refundTotal.set(
                r.instructorId,
                (refundTotal.get(r.instructorId) ?? 0) + r.refundMinor,
              );
              feeTotal.set(
                r.instructorId,
                (feeTotal.get(r.instructorId) ?? 0) + r.feeMinor,
              );
              netTotal.set(
                r.instructorId,
                (netTotal.get(r.instructorId) ?? 0) + r.netMinor,
              );
              // No step returns a negative refund or takes fee back.
              expect(r.refundMinor).toBeGreaterThanOrEqual(0);
              expect(r.feeMinor).toBeLessThanOrEqual(0);
              feeReturned -= r.feeMinor;
            }
            // The fee returned never exceeds the sale's.
            expect(feeReturned).toBeLessThanOrEqual(calculateFee(paid, bp));
            recorded = total;
          }
          expect(feeReturned).toBe(calculateFee(paid, bp));
          for (const s of soldTo) {
            const id = s.instructorId;
            expect(refundTotal.get(id) ?? 0).toBe(
              s.grossMinor - s.discountMinor,
            );
            expect(feeTotal.get(id) ?? 0).toBe(0 - s.feeMinor);
            expect(netTotal.get(id) ?? 0).toBe(0 - s.netMinor);
          }
        }
      }
    }
  });

  it('returns the same sums for totals 1 then 2 as for total 2 alone', () => {
    const input = {
      grossMinor: 2,
      paidMinor: 2,
      feeBasisPoints: 5000,
      instructorIds: ['a'],
    };
    const first = calculateRefund({
      ...input,
      recordedRefundedMinor: 0,
      refundedTotalMinor: 1,
    });
    const second = calculateRefund({
      ...input,
      recordedRefundedMinor: 1,
      refundedTotalMinor: 2,
    });
    const alone = calculateRefund({
      ...input,
      recordedRefundedMinor: 0,
      refundedTotalMinor: 2,
    });
    expect(first[0].feeMinor).toBe(-1);
    expect(second[0].feeMinor).toBe(0);
    expect(alone[0].feeMinor).toBe(-1);
    expect(first[0].refundMinor + second[0].refundMinor).toBe(
      alone[0].refundMinor,
    );
  });

  it('leaves out an instructor whose share of the step is zero in every figure', () => {
    const refunds = calculateRefund({
      grossMinor: 10,
      paidMinor: 10,
      feeBasisPoints: 0,
      instructorIds: ['a', 'b'],
      recordedRefundedMinor: 0,
      refundedTotalMinor: 1,
    });
    expect(refunds).toEqual([
      { instructorId: 'a', refundMinor: 1, feeMinor: 0, netMinor: -1 },
    ]);
  });

  it('rejects non-integers and a recorded total above the amount paid', () => {
    expect(() =>
      calculateRefund({
        ...sale,
        recordedRefundedMinor: 0,
        refundedTotalMinor: 10.5,
      }),
    ).toThrow();
    expect(() =>
      calculateRefund({
        ...sale,
        recordedRefundedMinor: 0.5,
        refundedTotalMinor: 10,
      }),
    ).toThrow();
    expect(() =>
      calculateRefund({
        ...sale,
        recordedRefundedMinor: 100,
        refundedTotalMinor: 100,
      }),
    ).toThrow();
  });
});
