/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ratingAverage, ratingCount, starCounts } from '@discava/core-table';

type CourseRatingRecord = Parameters<typeof starCounts>[0];

// A course's tally as callers see it: the average to one decimal, absent when
// nothing is rated. A missing record is an unrated course.
export const ratingFigures = (record?: CourseRatingRecord | null) => {
  const stars = starCounts(record ?? undefined);
  const average = ratingAverage(stars);
  return {
    count: ratingCount(stars),
    average: average === undefined ? undefined : Math.round(average * 10) / 10,
    stars,
  };
};
