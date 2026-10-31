/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import {
  anonymousCoreApi,
  apiUser,
  createPublishedCourseViaApi,
} from '../helpers/api.js';
import { expect, test } from '../helpers/table-invariants.js';

// Course search (#53), through the whole chain: instructor-api writes the
// course, the core table's stream reaches the event runner, the indexing
// handler writes OpenSearch, and core-api's course.publicSearch reads it back.
// Nothing here goes through a portal: the student portal's search box still
// filters course.publicList in the browser.

// The event runner batches stream records for a few seconds before indexing.
const INDEXED_WITHIN_MS = 30_000;

// One word no other course has, so a search for it finds only this test's
// courses even though a query matches any of its words.
const uniqueWord = () => `zq${randomUUID().replaceAll('-', '')}`;

// Signed out: search is public, like course.publicList.
const searchCourseIds = async (word: string) =>
  (
    await anonymousCoreApi().course.publicSearch.query({ q: word, limit: 50 })
  ).items.map((item) => item.courseId);

test.describe('course search', () => {
  test('a published course is searchable, until it is archived', async () => {
    const instructor = await apiUser('Sera', ['instructor']);
    const word = uniqueWord();
    const { courseId } = await createPublishedCourseViaApi(
      instructor,
      `Searchable ${word}`,
    );

    await expect
      .poll(() => searchCourseIds(word), { timeout: INDEXED_WITHIN_MS })
      .toEqual([courseId]);

    await instructor.instructor.course.archive.mutate({ courseId });

    await expect
      .poll(() => searchCourseIds(word), { timeout: INDEXED_WITHIN_MS })
      .toEqual([]);
  });

  test('a draft course is never searchable', async () => {
    const instructor = await apiUser('Dara', ['instructor']);
    const word = uniqueWord();
    await instructor.instructor.course.create.mutate({
      title: `Draft ${word}`,
    });
    // A published course with the same word: once it shows up on its own, the
    // draft had the same time to, so its absence is something to trust.
    const { courseId: published } = await createPublishedCourseViaApi(
      instructor,
      `Published ${word}`,
    );

    await expect
      .poll(() => searchCourseIds(word), { timeout: INDEXED_WITHIN_MS })
      .toEqual([published]);

    // Archived once done, so the courses this test publishes don't crowd the
    // student portal's catalogue and search, which list the newest 100.
    await instructor.instructor.course.archive.mutate({ courseId: published });
  });
});
