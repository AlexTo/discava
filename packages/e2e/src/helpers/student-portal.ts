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
// the page keeps checking until it lands (#237), so this waits without
// reloading: if the page stopped catching up, this would fail.
export const expectCourseCompleted = async (page: Page) => {
  await expect(page.getByText("You've completed this course")).toBeVisible({
    timeout: 30_000,
  });
};

// Opens the course's first lesson from the course home.
export const startFirstLesson = async (page: Page) => {
  await page.getByRole('link', { name: 'Start', exact: true }).click();
  await page.waitForURL(/\/learn\/[0-9a-f-]+\/lesson\/[0-9a-f-]+$/);
};

// One item in the open lesson, found by its title.
export const lessonItem = (page: Page, title: string) =>
  page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });

// The lesson's video player for the video item `title`, which is labelled with
// its title.
export const lessonVideo = (page: Page, title: string) =>
  page.locator('video').and(page.getByLabel(title, { exact: true }));

// Marks a text or video item done, and waits for the item to say so (its
// button gives way to a "Done" label).
export const markItemDone = async (page: Page, title: string) => {
  const item = lessonItem(page, title);
  await item.getByRole('button', { name: 'Mark as done' }).click();
  await expect(item.getByText('Done', { exact: true })).toBeVisible();
};

// Takes (or retakes) a one-question quiz, choosing `answer`, and submits it.
// Returns the quiz's item, which then shows the attempt's result.
export const takeQuiz = async (page: Page, title: string, answer: string) => {
  const quiz = lessonItem(page, title);
  await quiz
    .getByRole('button', { name: /^(Start quiz|Retake quiz)$/ })
    .click();
  await quiz.getByRole('radio', { name: answer, exact: true }).check();
  await quiz.getByRole('button', { name: 'Review answers' }).click();
  await quiz.getByRole('button', { name: 'Submit' }).click();
  return quiz;
};
