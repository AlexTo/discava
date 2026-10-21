/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// The real Course schema only has courseId/title/description - no code,
// category, level, duration, or icon/colour. Those are cosmetic catalogue
// details this prototype doesn't have a backend for yet, so they're filled
// in deterministically from courseId (not random) so a given course keeps
// the same look everywhere it's shown (landing page card, preview page)
// across refetches/re-renders instead of flickering or disagreeing.
const MOCK_ICONS = ['🧬', '∑', '⌁', '✎', '◉', '↗', '📊', '🗂', '🎤'];
const MOCK_SURFACES = [
  'from-emerald-500/20 to-teal-500/5',
  'from-blue-500/20 to-indigo-500/5',
  'from-violet-500/20 to-fuchsia-500/5',
  'from-amber-500/20 to-orange-500/5',
  'from-rose-500/20 to-pink-500/5',
  'from-cyan-500/20 to-sky-500/5',
];
export const MOCK_CATEGORIES = [
  'Science',
  'Technology',
  'Mathematics',
  'Communication',
  'Business',
] as const;
const MOCK_LEVELS = ['Beginner', 'Intermediate'] as const;
const MOCK_DURATIONS = [
  '3 weeks',
  '4 weeks',
  '6 weeks',
  '7 weeks',
  '8 weeks',
  '10 weeks',
];

export const categories = ['All', ...MOCK_CATEGORIES] as const;

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
  category: (typeof MOCK_CATEGORIES)[number];
  level: (typeof MOCK_LEVELS)[number];
  duration: string;
  icon: string;
  surface: string;
  // Its display image (#76); the icon and surface stand in until it has one.
  imageKey?: string;
}

export function toDisplayCourse(course: {
  courseId: string;
  title: string;
  description?: string;
  imageKey?: string;
}): DisplayCourse {
  const seed = hashString(course.courseId);
  const category = pick(MOCK_CATEGORIES, seed, 0);
  return {
    courseId: course.courseId,
    title: course.title,
    description: course.description || 'No description yet.',
    category,
    level: pick(MOCK_LEVELS, seed, 1),
    duration: pick(MOCK_DURATIONS, seed, 2),
    icon: pick(MOCK_ICONS, seed, 3),
    surface: pick(MOCK_SURFACES, seed, 4),
    imageKey: course.imageKey,
  };
}
