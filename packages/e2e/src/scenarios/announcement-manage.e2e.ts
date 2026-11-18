/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addLesson,
  addModule,
  addTextItem,
  createCourse,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// Managing a course's announcements in the instructor portal (#444): post,
// edit and delete from the course page.
test('an instructor posts, edits and deletes an announcement', async ({
  page,
}) => {
  const course = uniqueName('E2E announcements manage');
  const title = uniqueName('Welcome');

  await page.goto(`${PORTALS.instructor}/my-courses`);
  await signIn(page, newUser('Ivy', ['instructor']));
  await createCourse(page, {
    title: course,
    summary: 'A course whose announcements the end-to-end tests manage.',
  });
  await addModule(page, 'Module one');
  await addLesson(page, 'Lesson one');
  await addTextItem(page, { title: 'Reading', body: 'Text.' });
  await publishCourse(page);

  await expect(page.getByText('No announcements yet.')).toBeVisible();
  await screenshot(page, 'announcements with none posted');

  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Announcement text').fill('Welcome to the course.');
  await page.getByRole('button', { name: 'Post announcement' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('No announcements yet.')).toBeHidden();
  await screenshot(page, 'the posted announcement in the list');

  await page.getByRole('button', { name: `Edit ${title}` }).click();
  await expect(
    page.getByRole('button', { name: 'Save changes' }),
  ).toBeVisible();
  await screenshot(page, 'editing the announcement');
  // The post form is still on the page above the list: edit within the item.
  const editing = page.getByRole('listitem').filter({
    has: page.getByRole('button', { name: 'Save changes' }),
  });
  await editing.getByLabel('Announcement text').fill('Welcome, and good luck.');
  await editing.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Welcome, and good luck.')).toBeVisible();
  await expect(page.getByText(/edited/)).toBeVisible();

  await page.getByRole('button', { name: `Delete ${title}` }).click();
  const dialog = page.getByRole('alertdialog', {
    name: 'Delete announcement',
  });
  await expect(dialog).toContainText(
    'Students keep the notification they already received.',
  );
  await screenshot(page, 'the delete confirmation');
  await dialog.getByRole('button', { name: 'Delete announcement' }).click();
  await expect(page.getByText('No announcements yet.')).toBeVisible();
});
