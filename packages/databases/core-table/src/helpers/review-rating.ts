/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// The arithmetic on a course's rating tally, defined once for the writer, the
// invariants, core-api and the search document.

/** How many ratings the prior is worth: the pull towards PRIOR_MEAN. */
export const PRIOR_WEIGHT = 5;
/** The rating a course with no ratings is assumed to have. */
export const PRIOR_MEAN = 3.5;

export type Stars = [number, number, number, number, number];
export type StarField = 'stars1' | 'stars2' | 'stars3' | 'stars4' | 'stars5';

type CourseRatingRecord = Partial<Record<StarField, number>>;

/** Five counts, for 1 to 5 stars; an absent record or counter is 0. */
export const starCounts = (record?: CourseRatingRecord): Stars => [
  record?.stars1 ?? 0,
  record?.stars2 ?? 0,
  record?.stars3 ?? 0,
  record?.stars4 ?? 0,
  record?.stars5 ?? 0,
];

export const ratingCount = (stars: Stars) =>
  stars.reduce((sum, count) => sum + count, 0);

/** The mean rating, unrounded; undefined when nothing is rated. */
export const ratingAverage = (stars: Stars): number | undefined => {
  const count = ratingCount(stars);
  if (count === 0) {
    return undefined;
  }
  return stars.reduce((sum, n, i) => sum + n * (i + 1), 0) / count;
};

/**
 * The mean pulled towards PRIOR_MEAN by PRIOR_WEIGHT ratings, so one 5-star
 * rating doesn't outrank many good ones; undefined when nothing is rated.
 */
export const weightedRating = (stars: Stars): number | undefined => {
  const count = ratingCount(stars);
  const average = ratingAverage(stars);
  if (average === undefined) {
    return undefined;
  }
  return (count * average + PRIOR_WEIGHT * PRIOR_MEAN) / (count + PRIOR_WEIGHT);
};

/** The factor a course's search score is multiplied by; 1 when unrated. */
export const ratingBoost = (stars: Stars) => {
  const weighted = weightedRating(stars);
  return weighted === undefined ? 1 : 1 + 0.1 * (weighted - PRIOR_MEAN);
};

/** The counter a rating of 1 to 5 adds to. */
export const starField = (rating: number): StarField => {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new RangeError(`rating ${rating} is not an integer 1 to 5`);
  }
  return `stars${rating}` as StarField;
};
