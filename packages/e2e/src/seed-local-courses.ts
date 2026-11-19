/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  accessTokenForClaims,
  apiClients,
  createPublishedCourseViaApi,
} from './helpers/api.js';
import { ensureCategory, setCourseCatalogue } from './helpers/catalogue.js';

// Run with `pnpm nx run @discava/e2e:seed-local-courses` while `pnpm dev` is
// running: publishes a few courses, most with a category, tags, level,
// language and duration, as the local OIDC page's Alice, through
// instructor-api, so the stream indexes them for search the same way as any
// other publish. Adds to local data (run reset-local-data first for a clean
// slate). Creating Alice's first course also creates her public instructor
// profile (createCourse), so seeded courses have an instructor card.
const COURSES = [
  {
    title: 'Introduction to TypeScript',
    category: 'Programming',
    tags: ['typescript', 'javascript'],
    level: 'beginner',
    language: 'en',
    durationHours: 8,
  },
  {
    title: 'Serverless on AWS',
    category: 'Cloud',
    tags: ['aws', 'serverless'],
    level: 'intermediate',
    language: 'en',
    durationHours: 20,
  },
  {
    title: 'Testing React Applications',
    category: 'Programming',
    tags: ['react', 'testing'],
    level: 'intermediate',
    language: 'es',
    durationHours: 6,
  },
  {
    title: 'Designing DynamoDB Tables',
    category: 'Cloud',
    tags: ['aws', 'databases'],
    level: 'advanced',
    language: 'en',
    durationHours: 45,
  },
  {
    title: 'Learning to Learn',
    category: 'Personal development',
    tags: ['study-skills'],
    level: 'beginner',
    language: 'fr',
    durationHours: 1,
  },
  // No catalogue fields: a course the facets leave out.
  { title: 'Intro to Data Structures' },
] as const;

const alice = apiClients(
  await accessTokenForClaims('alice', {
    sub: '00000000-0000-4000-8000-000000000001',
    username: 'alice',
    email: 'alice@example.com',
    email_verified: true,
    given_name: 'Alice',
    family_name: 'Instructor',
    name: 'Alice Instructor',
    'cognito:groups': ['instructor', 'student'],
  }),
);

for (const { title, ...catalogue } of COURSES) {
  const { courseId } = await createPublishedCourseViaApi(alice, title);
  if ('category' in catalogue) {
    const { category, ...fields } = catalogue;
    const { categoryId } = await ensureCategory(category);
    await setCourseCatalogue(courseId, {
      ...fields,
      tags: [...fields.tags],
      categoryId,
    });
  }
  console.log(`Published "${title}"`);
}
