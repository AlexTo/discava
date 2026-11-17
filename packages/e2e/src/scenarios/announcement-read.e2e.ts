/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomBytes } from 'node:crypto';
import { apiUser } from '../helpers/api.js';
import { createUploadAssignmentCourse } from '../helpers/assignment.js';
import { screenshot } from '../helpers/screenshots.js';
import { enrol, openCourse } from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, uniqueName } from '../helpers/users.js';

// A UUID v7 for now, as the instructor portal mints for a new announcement.
const uuidV7 = () => {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const body = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', marks: [{ type: 'bold' }], text }],
      },
    ],
  });

// Reading announcements in the course home (#437): an enrolled student sees
// what the instructor posted, newest first.
test.describe('reading announcements in the course home', () => {
  test('an enrolled student sees the empty state, then the posted announcements', async ({
    page,
  }) => {
    const instructor = await apiUser('Ivy', ['instructor']);
    const title = uniqueName('E2E announcements course');
    const { courseId } = await createUploadAssignmentCourse(instructor, {
      courseTitle: title,
      assignmentTitle: 'Essay',
    });

    await openCourse(page, title);
    await enrol(page, newUser('Sam', ['student']));

    await expect(
      page.getByText("Your instructor hasn't posted anything yet."),
    ).toBeVisible();
    await screenshot(page, 'course home with no announcements');

    for (const heading of ['First notice', 'Second notice']) {
      await instructor.instructor.announcement.create.mutate({
        courseId,
        announcementId: uuidV7(),
        title: heading,
        body: body(`${heading} text`),
      });
    }
    await page.reload();

    const titles = page.getByRole('heading', { level: 3 });
    await expect(titles.first()).toHaveText('Second notice');
    await expect(titles.nth(1)).toHaveText('First notice');
    await expect(page.getByText(/Ivy .* posted/).first()).toBeVisible();
    await screenshot(page, 'course home with two announcements');
  });
});
