/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, type Page } from '@playwright/test';
import { PORTALS } from './portals.js';
import { signIn, type User } from './users.js';

// Steps in the student portal, for scenarios to build on.

// Finds a published course by searching for its title, and opens its page.
export const openCourse = async (page: Page, title: string) => {
  await page.goto(
    `${PORTALS.student}/search?query=${encodeURIComponent(title)}`,
  );
  await page.getByRole('link', { name: title }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: title }),
  ).toBeVisible();
};

// Enrols from the course page, signing in first when signed out (the way a
// visitor does, through the "Sign in to enrol" dialog), and starts learning.
export const enrol = async (page: Page, user?: User) => {
  await page.getByRole('button', { name: 'Enrol now' }).click();
  if (user) {
    await page
      .getByRole('dialog', { name: 'Sign in to enrol' })
      .getByRole('link', { name: 'Continue to sign in' })
      .click();
    await signIn(page, user);
    await page.getByRole('button', { name: 'Enrol now' }).click();
  }
  const enrolled = page.getByRole('dialog', { name: "You're enrolled!" });
  await enrolled.getByRole('link', { name: 'Start learning' }).click();
  await page.waitForURL(/\/learn\/[0-9a-f-]+\/home$/);
};

// Waits for the course home to say the student has completed the course.
// Progress recalculation runs a few seconds after their last completion, and
// the page shows its result the next time it fetches their enrolment, so this
// reloads until it does.
export const expectCourseCompleted = async (page: Page) => {
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("You've completed this course")).toBeVisible({
      timeout: 5_000,
    });
  }).toPass({ timeout: 45_000 });
};
