/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  BIO_MAX,
  DISPLAY_NAME_MAX,
  HANDLE_MAX,
  HANDLE_MIN,
  HANDLE_PATTERN,
  HEADLINE_MAX,
} from '../../entities/instructor-profile.js';
import { type Check, type Violation, violation } from './common.js';
import type { TableSnapshot } from './snapshot.js';

// Every instructor of a course has a public profile record, created with their
// first course (ensureInstructorProfile).
export const checkInstructorHasProfile = (
  snapshot: TableSnapshot,
): Violation[] => {
  const profiles = new Set(
    snapshot.instructorProfiles.map((p) => p.instructorId),
  );
  return snapshot.courseInstructors
    .filter((ci) => !profiles.has(ci.instructorId))
    .map((ci) =>
      violation(
        'instructor-has-profile',
        { courseId: ci.courseId, instructorId: ci.instructorId },
        'the instructor has no profile',
      ),
    );
};

// A profile's handle has exactly one claim, owned by that profile, and every
// claim's owner is a profile with that handle: instructorProfileWrites keeps
// the pair in one transaction.
export const checkProfileHandleClaimsConsistent = (
  snapshot: TableSnapshot,
): Violation[] => {
  const profiles = new Map(
    snapshot.instructorProfiles.map((p) => [p.instructorId, p]),
  );
  const problems = snapshot.instructorProfiles.flatMap((p) => {
    const claims = snapshot.profileHandleClaims.filter(
      (c) => c.handle === p.handle,
    );
    if (claims.length === 0) {
      return [
        violation(
          'profile-handle-claims-consistent',
          { instructorId: p.instructorId, handle: p.handle },
          'its handle has no claim',
        ),
      ];
    }
    return claims
      .filter((c) => c.instructorId !== p.instructorId)
      .map((c) =>
        violation(
          'profile-handle-claims-consistent',
          { instructorId: p.instructorId, handle: p.handle },
          `its handle is claimed by ${c.instructorId}`,
        ),
      );
  });
  const orphans = snapshot.profileHandleClaims
    .filter((c) => profiles.get(c.instructorId)?.handle !== c.handle)
    .map((c) =>
      violation(
        'profile-handle-claims-consistent',
        { instructorId: c.instructorId, handle: c.handle },
        "the claim's owner has no profile with that handle",
      ),
    );
  return [...problems, ...orphans];
};

// A profile's fields are within the entity's limits, and its version starts at
// 1.
export const checkInstructorProfileShape = (
  snapshot: TableSnapshot,
): Violation[] =>
  snapshot.instructorProfiles.flatMap((p) => {
    const problems: string[] = [];
    if (
      p.handle.length < HANDLE_MIN ||
      p.handle.length > HANDLE_MAX ||
      !HANDLE_PATTERN.test(p.handle)
    ) {
      problems.push(`handle ${p.handle} is not a valid handle`);
    }
    if (p.displayName.length < 1 || p.displayName.length > DISPLAY_NAME_MAX) {
      problems.push(
        `displayName is ${p.displayName.length} characters, not 1 to ${DISPLAY_NAME_MAX}`,
      );
    }
    if (p.headline !== undefined && p.headline.length > HEADLINE_MAX) {
      problems.push(`headline is over ${HEADLINE_MAX} characters`);
    }
    if (p.bio !== undefined && p.bio.length > BIO_MAX) {
      problems.push(`bio is over ${BIO_MAX} characters`);
    }
    if (!(p.version >= 1)) {
      problems.push(`version is ${p.version}, not at least 1`);
    }
    return problems.map((problem) =>
      violation(
        'instructor-profile-shape',
        { instructorId: p.instructorId },
        problem,
      ),
    );
  });

export const INSTRUCTOR_PROFILES_CHECKS = [
  { name: 'instructor-has-profile', check: checkInstructorHasProfile },
  {
    name: 'profile-handle-claims-consistent',
    check: checkProfileHandleClaimsConsistent,
  },
  { name: 'instructor-profile-shape', check: checkInstructorProfileShape },
] as const satisfies readonly Check[];
