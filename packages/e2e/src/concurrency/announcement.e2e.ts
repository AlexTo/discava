/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  announcementBody,
  announcementNotifications,
  uuidV7,
} from '../helpers/announcement.js';
import {
  type ApiUser,
  apiUser,
  createPublishedCourseViaApi,
} from '../helpers/api.js';
import { waitForQueuesToDrain } from '../helpers/router.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

// An announcement is posted once however many identical requests arrive at
// the same moment, and edits and deletes never recreate it (#447).

const REQUESTS = 10;

let instructor: ApiUser;
let student: ApiUser;
let courseId: string;

test.beforeEach(async () => {
  instructor = await apiUser('Ines', ['instructor']);
  ({ courseId } = await createPublishedCourseViaApi(
    instructor,
    uniqueName('Announcement race'),
  ));
  student = await apiUser('Sam', ['student']);
  await student.core.course.enrol.mutate({ courseId });
});

// Archived once done, so the courses these tests publish don't crowd the
// student portal's catalogue and search.
test.afterEach(async () => {
  await instructor.instructor.course.archive.mutate({ courseId });
});

const post = async (title: string) => {
  const announcementId = uuidV7();
  const input = {
    courseId,
    announcementId,
    title,
    body: announcementBody('Hello.'),
  };
  const { version } =
    await instructor.instructor.announcement.create.mutate(input);
  return { announcementId, version };
};

test('the same post sent ten times at once is one announcement and one broadcast', async () => {
  const title = uniqueName('Same post');
  const input = {
    courseId,
    announcementId: uuidV7(),
    title,
    body: announcementBody('Hello.'),
  };
  const results = await Promise.allSettled(
    Array.from({ length: REQUESTS }, () =>
      instructor.instructor.announcement.create.mutate(input),
    ),
  );
  // Each request either posted it or found it already posted: no other error.
  for (const result of results) {
    expect(result.status).toBe('fulfilled');
  }
  const { items } = await instructor.instructor.announcement.list.query({
    courseId,
  });
  expect(items.filter((item) => item.title === title)).toHaveLength(1);

  await waitForQueuesToDrain();
  await expect
    .poll(async () => (await announcementNotifications(student, title)).length)
    .toBe(1);
});

test('two edits with the same version: one wins and the other conflicts', async () => {
  const { announcementId, version } = await post(uniqueName('Edit race'));
  const results = await Promise.allSettled(
    ['First.', 'Second.'].map((text) =>
      instructor.instructor.announcement.update.mutate({
        courseId,
        announcementId,
        version,
        body: announcementBody(text),
      }),
    ),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((r) => r.status === 'rejected');
  expect(rejected?.status === 'rejected' && String(rejected.reason)).toContain(
    'changed',
  );
});

test('an edit and a delete at once never recreate the announcement', async () => {
  const { announcementId, version } = await post(uniqueName('Edit and delete'));
  await Promise.allSettled([
    instructor.instructor.announcement.update.mutate({
      courseId,
      announcementId,
      version,
      body: announcementBody('Edited.'),
    }),
    instructor.instructor.announcement.delete.mutate({
      courseId,
      announcementId,
    }),
  ]);
  const { items } = await instructor.instructor.announcement.list.query({
    courseId,
  });
  expect(
    items.find((item) => item.announcementId === announcementId),
  ).toBeUndefined();
});
