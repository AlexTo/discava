/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// A course's look is cosmetic and has no backend: an icon and colour filled
// in deterministically from courseId (not random) so a given course keeps the
// same look everywhere it's shown, across refetches and re-renders, instead
// of flickering or disagreeing. Its category,
// level, language and duration are real, from the catalogue.
const ICONS = ['🧬', '∑', '⌁', '✎', '◉', '↗', '📊', '🗂', '🎤'];
const SURFACES = [
  'from-emerald-500/20 to-teal-500/5',
  'from-blue-500/20 to-indigo-500/5',
  'from-violet-500/20 to-fuchsia-500/5',
  'from-amber-500/20 to-orange-500/5',
  'from-rose-500/20 to-pink-500/5',
  'from-cyan-500/20 to-sky-500/5',
];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function pick<T>(pool: readonly T[], seed: number, salt: number): T {
  return pool[(seed + salt) % pool.length];
}

export interface DisplayCourse {
  courseId: string;
  title: string;
  description: string;
  // The catalogue details the course has; none of them is required.
  category?: string;
  level?: string;
  language?: string;
  durationHours?: number;
  icon: string;
  surface: string;
  // Its display image (#76); the icon and surface stand in until it has one.
  imageKey?: string;
  // Its ratings, from the catalogue; absent where the source has none.
  ratingAverage?: number;
  ratingCount?: number;
  // Its price in the smallest currency unit (0 is free); absent where the
  // source has none, such as a course indexed before it had a price.
  priceAmount?: number;
  priceCurrency?: string;
}

export function toDisplayCourse(course: {
  courseId: string;
  title: string;
  description?: string;
  imageKey?: string;
  category?: { name: string };
  level?: string;
  language?: string;
  durationHours?: number;
  ratingAverage?: number;
  ratingCount?: number;
  priceAmount?: number;
  priceCurrency?: string;
}): DisplayCourse {
  const seed = hashString(course.courseId);
  return {
    courseId: course.courseId,
    title: course.title,
    description: course.description || 'No description yet.',
    category: course.category?.name,
    level: course.level,
    language: course.language,
    durationHours: course.durationHours,
    icon: pick(ICONS, seed, 3),
    surface: pick(SURFACES, seed, 4),
    imageKey: course.imageKey,
    ratingAverage: course.ratingAverage,
    ratingCount: course.ratingCount,
    priceAmount: course.priceAmount,
    priceCurrency: course.priceCurrency,
  };
}
