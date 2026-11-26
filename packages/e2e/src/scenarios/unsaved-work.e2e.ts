/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Route } from '@playwright/test';
import { addModule, createCourse } from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// Typed work isn't lost by accident: dismissing a dialog, leaving the course
// editor or a failed save each keep or ask about what was typed.
test('an instructor keeps typed work unless they say otherwise', async ({
  page,
}) => {
  await page.goto(`${PORTALS.instructor}/my-courses`);
  await signIn(page, newUser('Una', ['instructor']));
  await createCourse(page, {
    title: uniqueName('E2E unsaved work course'),
    summary: 'A course for the unsaved work scenario.',
  });
  await addModule(page, 'Module one');

  await test.step('Escape on a dialog with a typed title asks first', async () => {
    await page.getByRole('button', { name: 'New lesson' }).last().click();
    const dialog = page.getByRole('dialog', { name: 'New lesson' });
    const title = dialog.getByLabel('Lesson title');
    await title.fill('Half a thought');
    await page.keyboard.press('Escape');
    await expect(page.getByText('Discard unsaved changes?')).toBeVisible();
    await screenshot(page, 'discard unsaved changes');

    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(title).toHaveValue('Half a thought');
    await expect(title).toBeFocused();
    await screenshot(page, 'keep editing returns focus to the title');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step('leaving the editor with a changed price asks first', async () => {
    const price = page.getByLabel('Price', { exact: true });
    await price.fill('12.00');
    await page.getByRole('link', { name: 'My Courses' }).first().click();
    await expect(page.getByText('Leave without saving?')).toBeVisible();
    await screenshot(page, 'leave without saving');

    await page.getByRole('button', { name: 'Stay' }).click();
    await expect(page.getByText('Leave without saving?')).toBeHidden();
    await expect(price).toHaveValue('12.00');
  });

  await test.step('a failed save keeps the typed prompt', async () => {
    const abort = (route: Route) => route.abort('connectionfailed');
    await page.route('**/course.setFirstLessonPrompt*', abort);
    const prompt = page.getByLabel('Prompt', { exact: true });
    await prompt.fill('What surprised you most?');
    await page.getByRole('button', { name: 'Save prompt' }).click();
    await expect(page.getByText("Couldn't save the prompt")).toBeVisible();
    await expect(prompt).toHaveValue('What surprised you most?');
    await screenshot(page, 'failed save keeps the prompt');
  });
});
