/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  accessTokenForClaims,
  apiClients,
  createPublishedCourseViaApi,
} from './helpers/api.js';

// Run with `pnpm nx run @discava/e2e:seed-local-courses` while `pnpm dev` is
// running: publishes a few courses as the local OIDC page's Alice, through
// instructor-api, so the stream indexes them for search the same way as any
// other publish. Adds to local data (run reset-local-data first for a clean
// slate).
const COURSES = [
  'Introduction to TypeScript',
  'Serverless on AWS',
  'Testing React Applications',
  'Designing DynamoDB Tables',
  'Learning to Learn',
  'Intro to Data Structures',
];

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

for (const title of COURSES) {
  await createPublishedCourseViaApi(alice, title);
  console.log(`Published "${title}"`);
}
