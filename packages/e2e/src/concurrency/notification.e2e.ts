/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import {
  type ApiUser,
  apiUser,
  createPublishedCourseViaApi,
} from '../helpers/api.js';
import {
  publishAnnouncement,
  publishToCourseStudents,
} from '../helpers/notification.js';
import { waitForQueuesToDrain } from '../helpers/router.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

// A notification is created once however many identical publishes arrive at
// the same moment, and marking one read counts once (#279).

const REQUESTS = 10;

const notifications = async (user: ApiUser) =>
  (await user.core.notification.list.query({ limit: 50 })).items;

test('the same publish sent ten times at once is one notification', async () => {
  const student = await apiUser('Nina', ['student']);
  const label = uniqueName('Same publish');
  const dedupeKey = randomUUID();
  const occurredAt = new Date().toISOString();
  const results = await Promise.all(
    Array.from({ length: REQUESTS }, () =>
      publishAnnouncement(student.sub, label, { dedupeKey, occurredAt }),
    ),
  );
  expect(results.filter((r) => r.outcome === 'created')).toHaveLength(1);
  expect(await notifications(student)).toHaveLength(1);
  expect(
    (await student.core.notification.unreadCount.query()).unreadCount,
  ).toBe(1);
  await waitForQueuesToDrain();
});

test('the same notification marked read five times at once counts once', async () => {
  const student = await apiUser('Mina', ['student']);
  // Two, so a count that dropped more than once would show.
  await publishAnnouncement(student.sub, uniqueName('Read race'));
  await publishAnnouncement(student.sub, uniqueName('Read race other'));
  const [{ position }] = await notifications(student);
  await Promise.all(
    Array.from({ length: 5 }, () =>
      student.core.notification.markRead.mutate({ position }),
    ),
  );
  expect(
    (await student.core.notification.unreadCount.query()).unreadCount,
  ).toBe(1);
  await waitForQueuesToDrain();
});

test('a course audience published twice with the same key is one notification each', async () => {
  const instructor = await apiUser('Ines', ['instructor']);
  const { courseId } = await createPublishedCourseViaApi(
    instructor,
    uniqueName('Audience race'),
  );
  try {
    const students = await Promise.all(
      ['Sam', 'Sue'].map((name) => apiUser(name, ['student'])),
    );
    for (const student of students) {
      await student.core.course.enrol.mutate({ courseId });
    }
    const label = uniqueName('Audience');
    const dedupeKey = randomUUID();
    const occurredAt = new Date().toISOString();
    await publishToCourseStudents(courseId, label, dedupeKey, occurredAt);
    await publishToCourseStudents(courseId, label, dedupeKey, occurredAt);
    await waitForQueuesToDrain();
    for (const student of students) {
      await expect
        .poll(async () => (await notifications(student)).length)
        .toBe(1);
    }
  } finally {
    await instructor.instructor.course.archive.mutate({ courseId });
  }
});
