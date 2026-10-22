/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, type Page } from '@playwright/test';
import { PORTALS } from './portals.js';
import { expectToPlay } from './video.js';

// Steps in the instructor portal's course editor, for scenarios to build on.
// Each waits for what it did to show, so the next step starts from there.

// Creates a course from My Courses and opens its editor.
export const createCourse = async (
  page: Page,
  { title, summary }: { title: string; summary: string },
) => {
  await page.goto(`${PORTALS.instructor}/my-courses`);
  await page.getByRole('button', { name: 'Create course' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a course' });
  await dialog.getByLabel('Course title').fill(title);
  await dialog.getByLabel('Course summary').fill(summary);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(/\/my-courses\/[0-9a-f-]+$/);
  await expect(
    page.getByRole('heading', { level: 1, name: title }),
  ).toBeVisible();
};

export const addModule = async (page: Page, title: string) => {
  await page.getByRole('button', { name: 'New module' }).click();
  const dialog = page.getByRole('dialog', { name: 'New module' });
  await dialog.getByLabel('Module title').fill(title);
  await dialog.getByRole('button', { name: 'Create module' }).click();
  await expect(
    page.getByRole('button', { name: `Hide module ${title}` }),
  ).toBeVisible();
};

// Adds a lesson to the course's only (or last) module.
export const addLesson = async (page: Page, title: string) => {
  await page.getByRole('button', { name: 'New lesson' }).last().click();
  const dialog = page.getByRole('dialog', { name: 'New lesson' });
  await dialog.getByLabel('Lesson title').fill(title);
  await dialog.getByRole('button', { name: 'Create lesson' }).click();
  await expect(
    page.getByRole('button', { name: `Hide lesson ${title}` }),
  ).toBeVisible();
};

// Adds a text item to the last lesson.
export const addTextItem = async (
  page: Page,
  { title, body }: { title: string; body: string },
) => {
  await page.getByRole('button', { name: 'Text', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: 'Add text' });
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByLabel('Body', { exact: true }).fill(body);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByRole('button', { name: `Hide text ${title}` }),
  ).toBeVisible();
};

export const publishCourse = async (page: Page) => {
  await page.getByRole('button', { name: 'Publish' }).click();
  await page
    .getByRole('alertdialog', { name: 'Publish course' })
    .getByRole('button', { name: 'Publish' })
    .click();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
};

// Adds a video item to the last lesson, uploading `file`. Its transcode runs
// in the background (locally, ffmpeg in the event runner).
export const addVideoItem = async (
  page: Page,
  { title, file }: { title: string; file: string },
) => {
  await page.getByRole('button', { name: 'Video', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: 'Add video' });
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await dialog.getByLabel('file upload').setInputFiles(file);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByRole('button', { name: `Hide video ${title}` }),
  ).toBeVisible();
};

// Opens a video item's editor, which previews it once it's transcoded, and
// waits for the preview to play. The editor fetches the video's state when
// it opens, so this reopens it until the transcode is done.
export const expectVideoPreviewToPlay = async (page: Page, title: string) => {
  const dialog = page.getByRole('dialog', { name: 'Edit video' });
  await expect(async () => {
    if (await dialog.isVisible()) {
      await dialog.getByRole('button', { name: 'Cancel' }).click();
    }
    await page.getByRole('button', { name: `Edit ${title}` }).click();
    await expect(dialog.locator('video')).toBeAttached({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await expectToPlay(dialog.locator('video'));
  await dialog.getByRole('button', { name: 'Cancel' }).click();
};

// Adds a one-question, single-choice quiz to the last lesson, with a limit on
// attempts and the default 70% pass mark. `correct` is the option's text.
export const addQuiz = async (
  page: Page,
  {
    title,
    attempts,
    question,
    options,
    correct,
  }: {
    title: string;
    attempts: number;
    question: string;
    options: [string, string];
    correct: string;
  },
) => {
  await page.getByRole('button', { name: 'Quiz', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: 'New quiz' });
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await dialog.getByRole('checkbox', { name: 'Unlimited' }).uncheck();
  await dialog.getByLabel('Number of attempts').fill(String(attempts));
  await dialog.getByLabel('Question 1', { exact: true }).fill(question);
  for (const [index, option] of options.entries()) {
    await dialog
      .getByLabel(`Option ${index + 1}`, { exact: true })
      .fill(option);
  }
  await dialog
    .getByRole('radio', {
      name: `Option ${options.indexOf(correct) + 1} is correct`,
    })
    .check();
  await dialog.getByRole('button', { name: 'Save quiz' }).click();
  // The editor stays open after saving, saying so.
  await expect(dialog.getByRole('status')).toHaveText('Saved');
  await dialog.getByRole('button', { name: 'Close' }).first().click();
  await expect(
    page.getByRole('button', { name: `Hide quiz ${title}` }),
  ).toBeVisible();
};
