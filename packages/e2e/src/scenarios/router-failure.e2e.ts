/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { apiUser, createPublishedCourseViaApi } from '../helpers/api.js';
import {
  failNextBatches,
  redrive,
  routerQueues,
  waitForQueuesToDrain,
} from '../helpers/router.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

const SEARCH = 'search-indexing';
const PROGRESS = 'progress-recalculation';

// More failing batches than one message's receives (five), so another
// scenario's search batch using up one of them can't let this one through.
const FAILING_BATCHES = 10;

const failuresOf = async (feature: string) =>
  (await routerQueues()).find(({ name }) => name === feature)?.failures.count ??
  0;

// A failing feature fills only its own failure queue (FR-016, SC-005), and
// redriving that queue brings its changes back (FR-017). This changes
// nothing a user sees, so it takes no screenshots.
test('a failing search handler fills only its own failure queue, and a redrive recovers it', async () => {
  const title = uniqueName('Failing search');
  const instructor = await apiUser('Ines', ['instructor']);
  const student = await apiUser('Sam', ['student']);

  const isSearchable = async (courseId: string) =>
    (
      await student.core.course.publicSearch.query({ q: title, limit: 50 })
    ).items.some((hit) => hit.courseId === courseId);

  try {
    await failNextBatches(SEARCH, FAILING_BATCHES);
    const progressFailuresBefore = await failuresOf(PROGRESS);
    const { courseId, texts } = await createPublishedCourseViaApi(
      instructor,
      title,
    );

    await test.step('the change lands in search’s failure queue after its receives', async () => {
      const failuresBefore = await failuresOf(SEARCH);
      await expect
        .poll(() => failuresOf(SEARCH), { timeout: 90_000 })
        .toBeGreaterThan(failuresBefore);
      expect(await isSearchable(courseId)).toBe(false);
    });

    await test.step('progress still updates meanwhile', async () => {
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
      expect(await failuresOf(PROGRESS)).toBe(progressFailuresBefore);
    });

    await test.step('a redrive brings the course into the index', async () => {
      await failNextBatches(SEARCH, 0);
      const { redriven } = await redrive(SEARCH);
      expect(redriven).toBeGreaterThan(0);
      await expect
        .poll(() => isSearchable(courseId), { timeout: 30_000 })
        .toBe(true);
      await waitForQueuesToDrain();
      expect(await failuresOf(SEARCH)).toBe(0);
    });

    await instructor.instructor.course.archive.mutate({ courseId });
  } finally {
    // Whatever happened, later scenarios must not inherit the failures.
    await failNextBatches(SEARCH, 0);
  }
});
