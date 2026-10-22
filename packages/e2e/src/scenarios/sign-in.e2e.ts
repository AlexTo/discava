/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, test } from '@playwright/test';
import { PORTALS } from '../helpers/portals.js';
import { signIn, testUser } from '../helpers/users.js';

// Each portal sends a signed-out visitor to the local OIDC server (#226), and
// brings them back signed in to the page they asked for, with data from its
// API.

test('an instructor signs in to the instructor portal', async ({ page }) => {
  await page.goto(`${PORTALS.instructor}/my-courses`);
  await signIn(page, testUser('Alice'));

  await expect(page).toHaveURL(`${PORTALS.instructor}/my-courses`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'My Courses' }),
  ).toBeVisible();
  // Instructor-only: the course list came from instructor-api.
  await expect(
    page.getByRole('button', { name: 'Create course' }),
  ).toBeVisible();
});

test('a student signs in to the student portal', async ({ page }) => {
  await page.goto(`${PORTALS.student}/my-learning`);
  await signIn(page, testUser('Bob'));

  await expect(page).toHaveURL(`${PORTALS.student}/my-learning`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'My Learning' }),
  ).toBeVisible();
});

test('an admin signs in to the admin portal', async ({ page }) => {
  // The admin home page is still a mock-up (#6), so signing in and coming
  // back is what there is to check.
  await page.goto(PORTALS.admin);
  await signIn(page, testUser('Carol'));

  await expect(page).toHaveURL(`${PORTALS.admin}/`);
});
