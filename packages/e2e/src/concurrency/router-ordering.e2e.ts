/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { apiUser, createPublishedCourseViaApi } from '../helpers/api.js';
import { waitForQueuesToDrain } from '../helpers/router.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

// Search follows the course as the table holds it once the queues drain, not
// the order the router delivered its changes in (FR-012, SC-004): the handler
// re-reads the course for every batch, so a late or reordered message can't
// bring back a course that is no longer published.

// How many archive and restore round trips race each other.
const ROUND_TRIPS = 4;

test('archiving and restoring a course at the same moment leaves search matching the table', async () => {
  const title = uniqueName('Ordering race');
  const instructor = await apiUser('Ines', ['instructor']);
  const student = await apiUser('Sam', ['student']);
  const { courseId } = await createPublishedCourseViaApi(instructor, title);
  const api = instructor.instructor.course;

  // Publishing is itself a change on the stream: search settles first, so the
  // race below starts from an indexed course.
  const searchHits = async () =>
    (
      await student.core.course.publicSearch.query({ q: title, limit: 50 })
    ).items.filter((hit) => hit.courseId === courseId);
  await expect.poll(async () => (await searchHits()).length).toBe(1);

  // Archive and restore (which publishes again) from several requests at
  // once, so their stream records reach the router interleaved. Some calls
  // are refused (archiving what another request just archived); only the
  // table's final state matters.
  const requests = Array.from({ length: ROUND_TRIPS }, () => [
    api.archive.mutate({ courseId }),
    api.restore.mutate({ courseId }),
    api.publish.mutate({ courseId }),
  ]).flat();
  await Promise.allSettled(requests);

  await waitForQueuesToDrain();

  const { status } = await api.view.query({ courseId });
  expect(['published', 'archived', 'draft']).toContain(status);
  await expect
    .poll(async () => (await searchHits()).length, {
      message: `Search should hold the course exactly when it is ${status}`,
      timeout: 30_000,
    })
    .toBe(status === 'published' ? 1 : 0);
  if (status === 'published') {
    expect((await searchHits())[0]?.title).toBe(title);
    await api.archive.mutate({ courseId });
  }
});
