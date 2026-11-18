/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  announcementTitle,
  emailsFor,
  localSubFor,
  publishAnnouncement,
  unsubscribeLinkIn,
} from '../helpers/notification.js';
import { PORTALS } from '../helpers/portals.js';
import { waitForQueuesToDrain } from '../helpers/router.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// A notification, from publish to the bell, the email and its unsubscribe
// link (#279).
test('a student is notified in the bell and by email, and switches the email off', async ({
  browser,
  page,
}) => {
  const student = newUser('Nola', ['student']);
  const bystander = newUser('Otto', ['student']);
  const studentId = localSubFor(student.username);

  // Each signs in once so their record (and email address) exists.
  await page.goto(`${PORTALS.student}/my-learning`);
  await signIn(page, student);
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await otherPage.goto(`${PORTALS.student}/my-learning`);
  await signIn(otherPage, bystander);

  const first = uniqueName('First');
  const second = uniqueName('Second');
  await publishAnnouncement(studentId, first);
  await page.reload();

  // The bell counts it and lists it.
  const bell = page.getByRole('button', { name: 'Notifications, 1 unread' });
  await expect(bell).toBeVisible();
  await screenshot(page, 'bell with one unread');
  await bell.click();
  await expect(page.getByText(announcementTitle(first))).toBeVisible();
  await screenshot(page, 'list with one unread');

  // Opening it goes to its link and the count drops.
  await page.getByText(announcementTitle(first)).click();
  await page.waitForURL(/\/learn\/e2e-course\/home/);
  await expect(
    page.getByRole('button', { name: 'Notifications', exact: true }),
  ).toBeVisible();

  // A second one, cleared with "Mark all as read".
  await publishAnnouncement(studentId, second);
  await page.reload();
  await page.getByRole('button', { name: 'Notifications, 1 unread' }).click();
  await expect(page.getByText(announcementTitle(second))).toBeVisible();
  await page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(
    page.getByRole('button', { name: 'Notifications', exact: true }),
  ).toBeVisible();
  await screenshot(page, 'list with everything read');

  // The other user's bell was never touched.
  await otherPage.reload();
  await expect(
    otherPage.getByRole('button', { name: 'Notifications', exact: true }),
  ).toBeVisible();
  await otherContext.close();

  // One email arrived for each, with the way out.
  await waitForQueuesToDrain();
  await expect
    .poll(async () => (await emailsFor(student.email, first)).length)
    .toBe(1);
  const [email] = await emailsFor(student.email, first);
  expect(email.headers['List-Unsubscribe']).toBeTruthy();
  expect(await emailsFor(bystander.email, first)).toHaveLength(0);

  // Switched off in settings: the next one is in the bell but sends no email.
  await page.getByRole('button', { name: 'Open user menu' }).click();
  await page.getByRole('menuitem', { name: 'Notification settings' }).click();
  const toggle = page.getByRole('switch', { name: 'Course announcements' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await screenshot(page, 'announcements switched off');

  const third = uniqueName('Third');
  await publishAnnouncement(studentId, third);
  await waitForQueuesToDrain();
  await page.reload();
  await page.getByRole('button', { name: 'Notifications, 1 unread' }).click();
  await expect(page.getByText(announcementTitle(third))).toBeVisible();
  expect(await emailsFor(student.email, third)).toHaveLength(0);

  // The link from the first email, opened with no one signed in, switches the
  // type back on through the page.
  const fresh = await browser.newContext();
  const link = await fresh.newPage();
  await link.goto(unsubscribeLinkIn(email));
  await expect(
    link.getByRole('heading', {
      name: 'Stop Course announcements emails?',
    }),
  ).toBeVisible();
  await link.getByRole('button', { name: 'Stop these emails' }).click();
  await link.getByRole('button', { name: 'Turn them back on' }).click();
  await expect(
    link.getByText('Course announcements emails are back on.'),
  ).toBeVisible();
  await screenshot(link, 'emails turned back on from the email link');
  await fresh.close();

  await page.reload();
  await page.getByRole('button', { name: 'Open user menu' }).click();
  await page.getByRole('menuitem', { name: 'Notification settings' }).click();
  await expect(
    page.getByRole('switch', { name: 'Course announcements' }),
  ).toHaveAttribute('aria-checked', 'true');
});
