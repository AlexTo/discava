/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  PRIOR_MEAN,
  PRIOR_WEIGHT,
  ratingAverage,
  ratingBoost,
  ratingCount,
  type Stars,
  starCounts,
  starField,
  weightedRating,
} from './review-rating.js';

const TALLIES: Stars[] = [
  [0, 0, 0, 0, 0],
  [0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0],
  [3, 1, 4, 1, 5],
  [0, 0, 0, 10, 10],
  [10, 0, 0, 0, 0],
];

describe('starCounts', () => {
  it('reads an absent record, or an absent counter, as 0', () => {
    expect(starCounts(undefined)).toEqual([0, 0, 0, 0, 0]);
    expect(starCounts({})).toEqual([0, 0, 0, 0, 0]);
    expect(starCounts({ stars2: 3, stars5: 1 })).toEqual([0, 3, 0, 0, 1]);
  });
});

describe('an empty tally', () => {
  it('has no count, average or score, and a boost of 1', () => {
    const stars = starCounts();

    expect(ratingCount(stars)).toBe(0);
    expect(ratingAverage(stars)).toBeUndefined();
    expect(weightedRating(stars)).toBeUndefined();
    expect(ratingBoost(stars)).toBe(1);
  });
});

describe('the formulas', () => {
  it('uses a prior worth 5 ratings of 3.5', () => {
    expect(PRIOR_WEIGHT).toBe(5);
    expect(PRIOR_MEAN).toBe(3.5);
  });

  it.each(TALLIES.slice(1).map((t) => [t]))(
    'match their definitions for %j',
    (stars) => {
      const count = stars.reduce((a, b) => a + b, 0);
      const average = stars.reduce((a, n, i) => a + n * (i + 1), 0) / count;
      const score =
        (count * average + PRIOR_WEIGHT * PRIOR_MEAN) / (count + PRIOR_WEIGHT);

      expect(ratingCount(stars)).toBe(count);
      expect(ratingAverage(stars)).toBeCloseTo(average, 10);
      expect(weightedRating(stars)).toBeCloseTo(score, 10);
      expect(ratingBoost(stars)).toBeCloseTo(
        1 + 0.1 * (score - PRIOR_MEAN),
        10,
      );
    },
  );

  it('gives one 5-star rating a score of 3.75 and a boost of 1.025', () => {
    const stars: Stars = [0, 0, 0, 0, 1];

    expect(weightedRating(stars)).toBeCloseTo(3.75, 10);
    expect(ratingBoost(stars)).toBeCloseTo(1.025, 10);
  });

  it('ranks twenty 4.5-average ratings above one 5-star rating', () => {
    const many: Stars = [0, 0, 0, 10, 10];
    const one: Stars = [0, 0, 0, 0, 1];

    expect(ratingAverage(many)).toBe(4.5);
    expect(weightedRating(many)!).toBeGreaterThan(weightedRating(one)!);
  });

  it('keeps the boost above 0.75 and below 1.15', () => {
    for (const stars of TALLIES) {
      expect(ratingBoost(stars)).toBeGreaterThan(0.75);
      expect(ratingBoost(stars)).toBeLessThan(1.15);
    }
    expect(ratingBoost([10, 0, 0, 0, 0])).toBeCloseTo(0.8333, 3);
    expect(ratingBoost([0, 0, 0, 0, 1000])).toBeLessThan(1.15);
    expect(ratingBoost([1000, 0, 0, 0, 0])).toBeGreaterThan(0.75);
  });
});

describe('starField', () => {
  it.each([1, 2, 3, 4, 5])('maps %s to its counter', (rating) => {
    expect(starField(rating)).toBe(`stars${rating}`);
  });

  it.each([0, 6, 3.5, -1, Number.NaN])('rejects %s', (rating) => {
    expect(() => starField(rating)).toThrow(RangeError);
  });
});
