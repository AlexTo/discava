/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { PORTALS } from '../helpers/portals.js';
import { expect, test } from '../helpers/table-invariants.js';
import { signIn, testUser } from '../helpers/users.js';

// An instructor moves between the student and instructor portals from their
// headers (#67). Each portal keeps its own sign-in: deployed, Cognito's session
// signs the other one in without asking; the local OIDC server keeps no
// session, so here the instructor portal asks once.
test('an instructor switches to the instructor portal and back', async ({
  page,
}) => {
  await page.goto(`${PORTALS.student}/my-learning`);
  await signIn(page, testUser('Alice'));

  await page.getByRole('link', { name: 'Instructor', exact: true }).click();
  await signIn(page, testUser('Alice'));
  await expect(page).toHaveURL(`${PORTALS.instructor}/my-courses`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'My Courses' }),
  ).toBeVisible();

  // Back where they came from, still signed in there.
  await page.getByRole('link', { name: 'Student', exact: true }).click();
  await expect(page).toHaveURL(`${PORTALS.student}/my-learning`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'My Learning' }),
  ).toBeVisible();
});

test("a student who isn't an instructor isn't offered the instructor portal", async ({
  page,
}) => {
  await page.goto(`${PORTALS.student}/my-learning`);
  await signIn(page, testUser('Bob'));

  await expect(
    page.getByRole('heading', { level: 1, name: 'My Learning' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Instructor', exact: true }),
  ).toHaveCount(0);
});
