/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  REVIEW_REMOVED_REASON_MAX,
  REVIEW_RESPONSE_MAX,
  REVIEW_TEXT_MAX,
} from '../../entities/review.js';
import { starCounts } from '../review-rating.js';
import { type Check, groupBy, type Violation, violation } from './common.js';
import type { TableSnapshot } from './snapshot.js';

const present = (value: unknown) => value !== undefined && value !== null;

// A review is well formed: a rating of 1 to 5, a known status, a version
// of at least 1, text and response within their limits, a reviewer name, the
// response's four attributes all set or all absent, and the removal's three
// all set exactly when it is removed.
export const checkReviewShape = (snapshot: TableSnapshot): Violation[] =>
  snapshot.reviews.flatMap((r) => {
    const problems: string[] = [];
    if (!Number.isInteger(r.rating) || r.rating < 1 || r.rating > 5) {
      problems.push(`rating ${r.rating} is not an integer 1 to 5`);
    }
    if (r.status !== 'visible' && r.status !== 'removed') {
      problems.push(`status ${r.status} is not visible or removed`);
    }
    if (!(r.version >= 1)) {
      problems.push(`version is ${r.version}, not at least 1`);
    }
    if (r.text !== undefined && r.text.length > REVIEW_TEXT_MAX) {
      problems.push(`text is over ${REVIEW_TEXT_MAX} characters`);
    }
    if (!r.reviewerName) {
      problems.push('reviewerName is not set');
    }
    const response = [
      r.responseText,
      r.responseAt,
      r.responseById,
      r.responseByName,
    ];
    if (response.some(present) && !response.every(present)) {
      problems.push('the response attributes are not all set or all absent');
    } else if (
      r.responseText !== undefined &&
      (r.responseText.length < 1 || r.responseText.length > REVIEW_RESPONSE_MAX)
    ) {
      problems.push(
        `responseText is not 1 to ${REVIEW_RESPONSE_MAX} characters`,
      );
    }
    const removal = [r.removedAt, r.removedBy, r.removedReason];
    if (r.status === 'removed' && !removal.every(present)) {
      problems.push(
        'is removed without removedAt, removedBy and removedReason',
      );
    } else if (r.status === 'visible' && removal.some(present)) {
      problems.push('is visible but has removal attributes');
    }
    if (
      r.removedReason !== undefined &&
      r.removedReason.length > REVIEW_REMOVED_REASON_MAX
    ) {
      problems.push(
        `removedReason is over ${REVIEW_REMOVED_REASON_MAX} characters`,
      );
    }
    return problems.map((problem) =>
      violation(
        'review-shape',
        { courseId: r.courseId, userId: r.userId },
        problem,
      ),
    );
  });

// A review's student has an enrolment in its course, in any status
// (dropping keeps the record, and a review outlives it), and the course
// exists (an archived course still does).
export const checkReviewHasEnrolment = (
  snapshot: TableSnapshot,
): Violation[] => {
  const enrolled = new Set(
    snapshot.enrolments.map((e) => `${e.courseId} ${e.userId}`),
  );
  const courses = new Set(snapshot.courses.map((c) => c.courseId));
  return snapshot.reviews.flatMap((r) => {
    const record = { courseId: r.courseId, userId: r.userId };
    return [
      ...(courses.has(r.courseId)
        ? []
        : [
            violation(
              'review-has-enrolment',
              record,
              'its course does not exist',
            ),
          ]),
      ...(enrolled.has(`${r.courseId} ${r.userId}`)
        ? []
        : [
            violation(
              'review-has-enrolment',
              record,
              'its student has no enrolment',
            ),
          ]),
    ];
  });
};

// A course's rating tally counts its visible reviews: each stars<n> is
// the number of visible reviews rated n, a missing record meaning none of
// each, and every tally belongs to an existing course. reviewWrites changes
// the review and the tally in one transaction.
export const checkCourseRatingMatchesReviews = (
  snapshot: TableSnapshot,
): Violation[] => {
  const courses = new Set(snapshot.courses.map((c) => c.courseId));
  const tallies = new Map(snapshot.courseRatings.map((t) => [t.courseId, t]));
  const visible = groupBy(
    snapshot.reviews.filter((r) => r.status === 'visible'),
    (r) => r.courseId,
  );
  const mismatches = [
    ...new Set([...tallies.keys(), ...visible.keys()]),
  ].flatMap((courseId) => {
    const actual = starCounts(tallies.get(courseId));
    const reviews = visible.get(courseId) ?? [];
    return actual.flatMap((stored, i) => {
      const expected = reviews.filter((r) => r.rating === i + 1).length;
      return stored === expected
        ? []
        : [
            violation(
              'course-rating-matches-reviews',
              { courseId },
              `stars${i + 1} is ${stored}, but ${expected} visible reviews are rated ${i + 1}`,
            ),
          ];
    });
  });
  const orphans = snapshot.courseRatings
    .filter((t) => !courses.has(t.courseId))
    .map((t) =>
      violation(
        'course-rating-matches-reviews',
        { courseId: t.courseId },
        'its course does not exist',
      ),
    );
  return [...mismatches, ...orphans];
};

export const REVIEWS_CHECKS = [
  { name: 'review-shape', check: checkReviewShape },
  { name: 'review-has-enrolment', check: checkReviewHasEnrolment },
  {
    name: 'course-rating-matches-reviews',
    check: checkCourseRatingMatchesReviews,
  },
] as const satisfies readonly Check[];
