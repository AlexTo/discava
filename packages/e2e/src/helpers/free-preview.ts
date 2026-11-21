/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, type Page } from '@playwright/test';

// Steps for free preview lessons, for scenarios to build on.

// A lesson's row in the instructor portal's course editor, found by its title.
export const lessonRow = (page: Page, title: string) =>
  page
    .locator('article')
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();

// Marks the lesson as a free preview through the confirmation dialog. `beforeConfirm`
// runs with the dialog open, for a screenshot of it.
export const markFreePreview = async (
  page: Page,
  title: string,
  { beforeConfirm }: { beforeConfirm?: () => Promise<void> } = {},
) => {
  await lessonRow(page, title)
    .getByRole('button', { name: 'Make free preview' })
    .click();
  const dialog = page.getByRole('alertdialog', { name: 'Make free preview' });
  await expect(dialog).toContainText('Quizzes stay locked.');
  await beforeConfirm?.();
  await dialog.getByRole('button', { name: 'Make free preview' }).click();
  await expect(
    lessonRow(page, title).getByRole('button', {
      name: 'Remove free preview',
    }),
  ).toBeVisible();
};

// Removes the lesson's mark, which takes effect at once.
export const removeFreePreview = async (page: Page, title: string) => {
  await lessonRow(page, title)
    .getByRole('button', { name: 'Remove free preview' })
    .click();
  await expect(
    lessonRow(page, title).getByRole('button', { name: 'Make free preview' }),
  ).toBeVisible();
};
