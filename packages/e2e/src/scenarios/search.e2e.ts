/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { apiUser } from '../helpers/api.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

// Cross-content-type search (#53) end to end, through the APIs: an instructor
// publishes a course whose title, module, lesson and content item all carry a
// run-unique token, and a search for that token finds the course, the module,
// the lesson and the content item. The hit is only possible once the core
// table's stream has reached the search indexer and written the documents to
// OpenSearch, so the search polls until the index catches up. The portals have
// no search UI yet, so this drives the core-api `search` procedure directly,
// the way a portal would once it ships one.
test('a search finds a course, module, lesson and content item that share a token', async () => {
  const token = uniqueName('E2E search');
  const courseTitle = `Course ${token}`;
  const moduleTitle = `Module ${token}`;
  const lessonTitle = `Lesson ${token}`;
  const itemTitle = `Reading ${token}`;
  const instructor = await apiUser('E2E Search Instructor', ['instructor']);
  const admin = await apiUser('E2E Search Admin', ['admin']);

  await test.step('an instructor publishes a course, module, lesson and content item', async () => {
    const api = instructor.instructor;
    const { courseId } = await api.course.create.mutate({ title: courseTitle });
    const { moduleId } = await api.module.create.mutate({
      courseId,
      title: moduleTitle,
    });
    const { lessonId } = await api.lesson.create.mutate({
      courseId,
      moduleId,
      title: lessonTitle,
    });
    await api.contentItem.createText.mutate({
      courseId,
      moduleId,
      lessonId,
      title: itemTitle,
      body: JSON.stringify({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: token }] },
        ],
      }),
    });
    await api.course.publish.mutate({ courseId });
  });

  await test.step('a search for the token finds all four, once the index catches up', async () => {
    // The core table's stream is batched (5s windows) and OpenSearch refreshes
    // near-realtime, so the documents appear seconds after the publish; poll
    // until the course (the first thing reindexed) is searchable.
    await expect(async () => {
      const { results } = await admin.core.search.query({ query: token });
      // arrayContaining matches against an array, so de-duplicate through a
      // Set and hand it back out as one (an admin also searches users, so the
      // set is a superset of the four content types).
      const types = Array.from(new Set(results.map((r) => r.type)));
      expect(types).toEqual(
        expect.arrayContaining(['course', 'module', 'lesson', 'contentItem']),
      );
      // The course and content item hits carry their titles (a user document
      // has none, so read the title through the common { title? } shape).
      const titleOf = (type: string) =>
        results.find((r) => r.type === type)?.document as
          | { title?: string }
          | undefined;
      expect(titleOf('course')?.title).toBe(courseTitle);
      expect(titleOf('contentItem')?.title).toBe(itemTitle);
    }).toPass({ timeout: 60_000 });
  });
});
