/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, type Page } from '@playwright/test';
import { PORTALS } from './portals.js';

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
  // The rich text editor has no accessible name of its own yet.
  await dialog.locator('[contenteditable="true"]').fill(body);
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
