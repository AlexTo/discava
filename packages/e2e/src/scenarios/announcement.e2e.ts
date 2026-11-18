/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  announcementNotifications,
  dropEnrolment,
} from '../helpers/announcement.js';
import { apiUser, createPublishedCourseViaApi } from '../helpers/api.js';
import {
  addLesson,
  addModule,
  addTextItem,
  createCourse,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { waitForQueuesToDrain } from '../helpers/router.js';
import { screenshot } from '../helpers/screenshots.js';
import { enrol, openCourse } from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// An announcement from post to delete (#447): the instructor posts it in the
// portal, the enrolled students read it in the course home, and neither the
// student who dropped nor another course's can.
test('an announcement is posted, read by the enrolled students, edited and deleted', async ({
  browser,
  page,
}) => {
  const course = uniqueName('E2E announcement');
  const title = uniqueName('Welcome');
  const quiet = await apiUser('Quin', ['instructor']);
  const otherCourse = await createPublishedCourseViaApi(
    quiet,
    uniqueName('E2E other course'),
  );

  await page.goto(`${PORTALS.instructor}/my-courses`);
  await signIn(page, newUser('Ivy', ['instructor']));
  await createCourse(page, {
    title: course,
    summary: 'A course whose announcement the end-to-end test follows.',
  });
  await addModule(page, 'Module one');
  await addLesson(page, 'Lesson one');
  await addTextItem(page, { title: 'Reading', body: 'Text.' });
  await publishCourse(page);
  const courseId = /my-courses\/([0-9a-f-]+)/.exec(page.url())?.[1] ?? '';
  expect(courseId).not.toBe('');

  // Three students: one in the browser, one through the API, and one who
  // enrols and then drops. A fourth is only in another course.
  const studentPage = await (await browser.newContext()).newPage();
  await openCourse(studentPage, course);
  await enrol(studentPage, newUser('Sam', ['student']));
  const enrolled = await apiUser('Sue', ['student']);
  await enrolled.core.course.enrol.mutate({ courseId });
  const dropped = await apiUser('Drew', ['student']);
  await dropped.core.course.enrol.mutate({ courseId });
  await dropEnrolment(courseId, dropped);
  const elsewhere = await apiUser('Eli', ['student']);
  await elsewhere.core.course.enrol.mutate({ courseId: otherCourse.courseId });

  await page.getByLabel('Title', { exact: true }).fill(title);
  const editor = page.getByLabel('Announcement text');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('Welcome to the course.');
  await page.getByRole('button', { name: 'Post announcement' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await screenshot(page, 'the instructor after posting');

  await studentPage.reload();
  await expect(studentPage.getByRole('heading', { name: title })).toBeVisible();
  await expect(studentPage.getByText('Welcome to the course.')).toBeVisible();
  await screenshot(studentPage, 'the announcement in the course home');
  const listed = await enrolled.core.announcement.list.query({ courseId });
  expect(listed.items.map((item) => item.title)).toEqual([title]);
  await expect(
    dropped.core.announcement.list.query({ courseId }),
  ).rejects.toThrow();
  await expect(
    elsewhere.core.announcement.list.query({ courseId }),
  ).rejects.toThrow();

  // Each enrolled student is told once; the instructor, the dropped student
  // and the other course's get nothing. Posting is the only thing that sends.
  await waitForQueuesToDrain();
  await expect
    .poll(async () => (await announcementNotifications(enrolled, title)).length)
    .toBe(1);
  expect(await announcementNotifications(dropped, title)).toHaveLength(0);
  expect(await announcementNotifications(elsewhere, title)).toHaveLength(0);

  await page.getByRole('button', { name: `Edit ${title}` }).click();
  const editing = page.getByRole('listitem').filter({
    has: page.getByRole('button', { name: 'Save changes' }),
  });
  await editing.getByLabel('Announcement text').fill('Welcome, and good luck.');
  await editing.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Welcome, and good luck.')).toBeVisible();

  await studentPage.reload();
  await expect(studentPage.getByText('Welcome, and good luck.')).toBeVisible();
  await expect(studentPage.getByText(/edited/)).toBeVisible();
  await screenshot(studentPage, 'the edited announcement in the course home');
  await waitForQueuesToDrain();
  expect(await announcementNotifications(enrolled, title)).toHaveLength(1);

  await page.getByRole('button', { name: `Delete ${title}` }).click();
  await page
    .getByRole('alertdialog', { name: 'Delete announcement' })
    .getByRole('button', { name: 'Delete announcement' })
    .click();
  await expect(page.getByText('No announcements yet.')).toBeVisible();
  await studentPage.reload();
  await expect(studentPage.getByRole('heading', { name: title })).toBeHidden();
  // Students keep the notification they already received.
  expect(await announcementNotifications(enrolled, title)).toHaveLength(1);
});
