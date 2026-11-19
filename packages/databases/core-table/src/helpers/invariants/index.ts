/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ANALYTICS_CHECKS } from './analytics.js';
import { CATALOGUE_CHECKS } from './catalogue.js';
import { CERTIFICATES_CHECKS } from './certificates.js';
import type { Violation } from './common.js';
import { CURRICULUM_CHECKS } from './curriculum.js';
import { DISCUSSION_CHECKS } from './discussion.js';
import { INSTRUCTOR_PROFILES_CHECKS } from './instructor-profiles.js';
import { MEDIA_CHECKS } from './media.js';
import { NOTIFICATIONS_CHECKS } from './notifications.js';
import { REVIEWS_CHECKS } from './reviews.js';
import type { TableSnapshot } from './snapshot.js';
import { STUDENT_ACTIVITY_CHECKS } from './student-activity.js';

// Every check, by topic. A check is `{ name, check }`; its name is the
// invariant it reports.
const CHECKS = [
  ...CURRICULUM_CHECKS,
  ...STUDENT_ACTIVITY_CHECKS,
  ...CERTIFICATES_CHECKS,
  ...MEDIA_CHECKS,
  ...ANALYTICS_CHECKS,
  ...NOTIFICATIONS_CHECKS,
  ...CATALOGUE_CHECKS,
  ...DISCUSSION_CHECKS,
  ...REVIEWS_CHECKS,
  ...INSTRUCTOR_PROFILES_CHECKS,
] as const;

export type InvariantName = (typeof CHECKS)[number]['name'];

export const INVARIANTS: readonly InvariantName[] = CHECKS.map(
  ({ name }) => name,
);

export interface InvariantViolation extends Violation {
  invariant: InvariantName;
}

// A stable identity for a violation, to compare two checks of the same
// table (e.g. before and after an e2e scenario).
export const violationId = ({ invariant, record }: InvariantViolation) =>
  `${invariant} ${JSON.stringify(record)}`;

// Every violation in the snapshot, by every check.
export const checkTableInvariants = (
  snapshot: TableSnapshot,
): InvariantViolation[] =>
  // A check may report under another invariant's name (course-preview-shape
  // also reports caption-tracks-valid), so each violation keeps its own.
  CHECKS.flatMap(({ check }) => check(snapshot) as InvariantViolation[]);

export { checkAnalyticsMatchesRecords } from './analytics.js';
export {
  emptyTableSnapshot,
  loadTableSnapshot,
  type TableSnapshot,
} from './snapshot.js';
