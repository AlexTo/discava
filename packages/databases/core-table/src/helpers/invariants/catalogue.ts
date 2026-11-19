/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  DURATION_HOURS_MAX,
  DURATION_HOURS_MIN,
  LANGUAGES,
  LEVELS,
  MAX_TAGS,
  normaliseCategoryName,
  normaliseTags,
} from '../catalogue-vocabulary.js';
import {
  LANDING_ITEM_MAX_LENGTH,
  LANDING_LIST_MAX_ITEMS,
} from '../course-landing.js';
import { type Check, type Violation, violation } from './common.js';
import type { TableSnapshot } from './snapshot.js';

// A course's category, when it has one, exists.
export const checkCourseCategoryExists = (
  snapshot: TableSnapshot,
): Violation[] => {
  const categoryIds = new Set(snapshot.categories.map((c) => c.categoryId));
  return snapshot.courses
    .filter((c) => c.categoryId !== undefined && !categoryIds.has(c.categoryId))
    .map((c) =>
      violation(
        'course-category-exists',
        { courseId: c.courseId },
        `categoryId ${c.categoryId} names no category`,
      ),
    );
};

// Every category has exactly one slug claim and one name claim pointing
// back to it, with its slug and its normalised (lower-cased) name; every claim
// belongs to an existing category.
export const checkCategoryClaimsConsistent = (
  snapshot: TableSnapshot,
): Violation[] => {
  const categoryIds = new Set(snapshot.categories.map((c) => c.categoryId));
  const perCategory = snapshot.categories.flatMap((c) => {
    const owned = snapshot.categoryClaims.filter(
      (claim) => claim.categoryId === c.categoryId,
    );
    const slugs = owned.filter((claim) => claim.claim.startsWith('slug#'));
    const names = owned.filter((claim) => claim.claim.startsWith('name#'));
    const problems: string[] = [];
    if (slugs.length !== 1) {
      problems.push(`has ${slugs.length} slug claims, not 1`);
    } else if (slugs[0].claim !== `slug#${c.slug}`) {
      problems.push(`its slug claim ${slugs[0].claim} is not for its slug`);
    }
    if (names.length !== 1) {
      problems.push(`has ${names.length} name claims, not 1`);
    } else if (
      names[0].claim !==
      `name#${normaliseCategoryNameSafe(c.name).toLowerCase()}`
    ) {
      problems.push(`its name claim ${names[0].claim} is not for its name`);
    }
    return problems.map((problem) =>
      violation(
        'category-claims-consistent',
        { categoryId: c.categoryId },
        problem,
      ),
    );
  });
  const orphans = snapshot.categoryClaims
    .filter((claim) => !categoryIds.has(claim.categoryId))
    .map((claim) =>
      violation(
        'category-claims-consistent',
        { claim: claim.claim },
        `claim points to no category (${claim.categoryId})`,
      ),
    );
  return [...perCategory, ...orphans];
};

// A name that fails normalisation is compared as typed, so a malformed
// category is reported by the claim check rather than crashing the scan.
const normaliseCategoryNameSafe = (name: string) => {
  try {
    return normaliseCategoryName(name);
  } catch {
    return name;
  }
};

// A course's catalogue fields are well formed: tags normalised, unique and
// at most 8; level and language in their sets; duration a whole number in
// range. A course without them is fine.
export const checkCourseCatalogueShape = (
  snapshot: TableSnapshot,
): Violation[] =>
  snapshot.courses.flatMap((c) => {
    const problems: string[] = [];
    if (c.tags !== undefined) {
      try {
        const normalised = normaliseTags(c.tags);
        if (
          normalised.length !== c.tags.length ||
          normalised.some((tag, i) => tag !== c.tags?.[i])
        ) {
          problems.push('tags are not normalised and unique');
        }
      } catch {
        problems.push(
          `tags are not 1 to 30 characters each, at most ${MAX_TAGS}`,
        );
      }
    }
    if (c.level !== undefined && !LEVELS.includes(c.level)) {
      problems.push(`level ${c.level} is not allowed`);
    }
    if (c.language !== undefined && !LANGUAGES.includes(c.language)) {
      problems.push(`language ${c.language} is not allowed`);
    }
    if (
      c.durationHours !== undefined &&
      !(
        Number.isInteger(c.durationHours) &&
        c.durationHours >= DURATION_HOURS_MIN &&
        c.durationHours <= DURATION_HOURS_MAX
      )
    ) {
      problems.push(
        `durationHours ${c.durationHours} is not a whole number ${DURATION_HOURS_MIN} to ${DURATION_HOURS_MAX}`,
      );
    }
    return problems.map((problem) =>
      violation('course-catalogue-shape', { courseId: c.courseId }, problem),
    );
  });

// A course's landing page lists are well formed: at most 10 items each, every
// item 1 to 160 characters and already trimmed. A course without them is fine.
export const checkCourseLandingShape = (snapshot: TableSnapshot): Violation[] =>
  snapshot.courses.flatMap((c) =>
    (['learningOutcomes', 'requirements'] as const).flatMap((field) => {
      const items = c[field];
      if (items === undefined) {
        return [];
      }
      const problems: string[] = [];
      if (items.length > LANDING_LIST_MAX_ITEMS) {
        problems.push(
          `${field} has ${items.length} items, at most ${LANDING_LIST_MAX_ITEMS}`,
        );
      }
      items.forEach((item, i) => {
        if (item.length < 1 || item.length > LANDING_ITEM_MAX_LENGTH) {
          problems.push(
            `${field} item ${i + 1} is ${item.length} characters, not 1 to ${LANDING_ITEM_MAX_LENGTH}`,
          );
        } else if (item !== item.trim()) {
          problems.push(`${field} item ${i + 1} is not trimmed`);
        }
      });
      return problems.map((problem) =>
        violation('course-landing-shape', { courseId: c.courseId }, problem),
      );
    }),
  );

export const CATALOGUE_CHECKS = [
  { name: 'course-landing-shape', check: checkCourseLandingShape },
  { name: 'course-category-exists', check: checkCourseCategoryExists },
  { name: 'category-claims-consistent', check: checkCategoryClaimsConsistent },
  { name: 'course-catalogue-shape', check: checkCourseCatalogueShape },
] as const satisfies readonly Check[];
