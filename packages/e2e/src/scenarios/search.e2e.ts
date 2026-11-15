/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { apiUser, createPublishedCourseViaApi } from '../helpers/api.js';
import { PORTALS } from '../helpers/portals.js';
import {
  expectAfterReloads,
  searchWithSiteSearch,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

// Publish -> searchable -> archive -> gone (#267): course.publicSearch is
// fed by the core table's stream, which batches for up to 5s, so a course
// takes a few seconds to appear after publishing and to disappear after
// archiving -- expectAfterReloads keeps checking rather than reloading once.
test('a published course is searchable, and gone once archived', async ({
  page,
}) => {
  const title = uniqueName('Searchable course');
  const instructor = await apiUser('Ines', ['instructor']);
  const { courseId } = await createPublishedCourseViaApi(instructor, title);

  await test.step('it turns up in a search for its title', async () => {
    await page.goto(PORTALS.student);
    await searchWithSiteSearch(page, title);
    await expectAfterReloads(page, async () => {
      await expect(page.getByRole('link', { name: title })).toBeVisible({
        timeout: 2_000,
      });
    });
  });

  await test.step('archiving it removes it from search results', async () => {
    await instructor.instructor.course.archive.mutate({ courseId });
    await expectAfterReloads(page, async () => {
      await expect(page.getByRole('link', { name: title })).toHaveCount(0);
    });
  });
});
