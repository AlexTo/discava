/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { STREAM_FEATURES } from '@discava/core-table';
import { apiUser, createPublishedCourseViaApi } from '../helpers/api.js';
import { routerQueues, waitForQueuesToDrain } from '../helpers/router.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

// Both stream features run through the router and their own queues locally,
// as they do deployed: search follows publish and archive, progress follows a
// completion, and nothing lands in a failure queue. This changes nothing a
// user sees, so it takes no screenshots.
test('stream changes reach search and progress through the router queues', async () => {
  const title = uniqueName('Routed course');
  const instructor = await apiUser('Ines', ['instructor']);
  const student = await apiUser('Sam', ['student']);
  const { courseId, texts } = await createPublishedCourseViaApi(
    instructor,
    title,
  );

  await test.step('a published course is searchable', async () => {
    await expect
      .poll(
        async () =>
          (await student.core.course.publicSearch.query({ q: title })).items
            .length,
        { timeout: 30_000 },
      )
      .toBe(1);
  });

  await test.step('completing an item moves the student’s progress', async () => {
    await student.core.course.enrol.mutate({ courseId });
    await student.core.contentItem.complete.mutate(texts[0]!);
    await expect
      .poll(
        async () =>
          (await student.core.course.myEnrolments.query()).items.find(
            (item) => item.courseId === courseId,
          )?.progressPercent ?? 0,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
  });

  await test.step('archiving removes it from search', async () => {
    await instructor.instructor.course.archive.mutate({ courseId });
    await expect
      .poll(
        async () =>
          (await student.core.course.publicSearch.query({ q: title })).items
            .length,
        { timeout: 30_000 },
      )
      .toBe(0);
  });

  await test.step('every feature has a queue, and nothing failed', async () => {
    await waitForQueuesToDrain();
    const states = await routerQueues();
    expect(states.map(({ name }) => name).sort()).toEqual(
      STREAM_FEATURES.map(({ name }) => name).sort(),
    );
    for (const state of states) {
      expect(state.failures.count, `${state.name}'s failure queue`).toBe(0);
    }
  });
});
