/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { apiUser, createPublishedCourseViaApi } from '../helpers/api.js';
import { createCategory, setCourseCatalogue } from '../helpers/catalogue.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
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

// Facet counts (the catalogue's filters): four published courses that differ
// in every field, scoped to this run by a tag no other course has, so every
// count below is a hand count of these four.
//
//   course  category  level         language  hours  band    tags
//   A       one       beginner      en        1      lt2     scope, sql
//   B       one       beginner      fr        5      2to10   scope
//   C       two       advanced      en        30     10to40  scope, sql
//   D       -         intermediate  en        100    gt40    scope
//
// A draft and an archived course carry the same tag and count nowhere.
test('facets count the published courses under each filter', async ({
  page,
}) => {
  const scope = uniqueName('scope').toLowerCase();
  const sqlTag = `${scope}-sql`;
  const instructor = await apiUser('Fay', ['instructor']);
  const one = await createCategory(uniqueName('Facet one'));
  const two = await createCategory(uniqueName('Facet two'));

  const publish = async (
    label: string,
    catalogue: Parameters<typeof setCourseCatalogue>[1],
  ) => {
    const { courseId } = await createPublishedCourseViaApi(
      instructor,
      uniqueName(`Facet ${label}`),
    );
    await setCourseCatalogue(courseId, catalogue);
    return courseId;
  };
  await publish('A', {
    categoryId: one.categoryId,
    level: 'beginner',
    language: 'en',
    durationHours: 1,
    tags: [scope, sqlTag],
  });
  await publish('B', {
    categoryId: one.categoryId,
    level: 'beginner',
    language: 'fr',
    durationHours: 5,
    tags: [scope],
  });
  await publish('C', {
    categoryId: two.categoryId,
    level: 'advanced',
    language: 'en',
    durationHours: 30,
    tags: [scope, sqlTag],
  });
  await publish('D', {
    level: 'intermediate',
    language: 'en',
    durationHours: 100,
    tags: [scope],
  });
  const archived = await publish('archived', {
    level: 'beginner',
    language: 'en',
    durationHours: 1,
    tags: [scope],
  });
  await instructor.instructor.course.archive.mutate({ courseId: archived });
  const { courseId: draft } = await instructor.instructor.course.create.mutate({
    title: uniqueName('Facet draft'),
  });
  await setCourseCatalogue(draft, { level: 'beginner', tags: [scope] });

  const open = async (filters: Record<string, string[]> = {}) => {
    const params = new URLSearchParams({
      // Tags are OR, so a tag filter replaces the scope rather than adding.
      tags: JSON.stringify(filters.tags ?? [scope]),
    });
    for (const [name, values] of Object.entries(filters)) {
      if (name !== 'tags') {
        params.set(name, JSON.stringify(values));
      }
    }
    await page.goto(`${PORTALS.student}/search?${params}`);
  };
  const count = (label: string) =>
    page.getByRole('checkbox', { name: label, exact: true });

  await test.step('no filter beyond the scope counts each value of the four', async () => {
    // The index follows the table's stream by up to a few seconds.
    await expectAfterReloads(page, async () => {
      await open();
      await expect(page.getByText('4 courses')).toBeVisible({ timeout: 2_000 });
    });
    await expect(count('Beginner (2)')).toBeVisible();
    await expect(count('Intermediate (1)')).toBeVisible();
    await expect(count('Advanced (1)')).toBeVisible();
    await expect(count('English (3)')).toBeVisible();
    await expect(count('French (1)')).toBeVisible();
    await expect(count('Under 2 hours (1)')).toBeVisible();
    await expect(count('2 to 10 hours (1)')).toBeVisible();
    await expect(count('Over 10 to 40 hours (1)')).toBeVisible();
    await expect(count('Over 40 hours (1)')).toBeVisible();
    await expect(count(`${one.name} (2)`)).toBeVisible();
    await expect(count(`${two.name} (1)`)).toBeVisible();
    await screenshot(page, 'facets-for-four-courses');
  });

  await test.step('one value narrows the courses; its own facet keeps the other values', async () => {
    await open({ levels: ['beginner'] });
    await expect(page.getByText('2 courses')).toBeVisible();
    // The level facet ignores its own filter; the others follow it.
    await expect(count('Beginner (2)')).toBeChecked();
    await expect(count('Advanced (1)')).toBeVisible();
    await expect(count('English (1)')).toBeVisible();
    await expect(count('French (1)')).toBeVisible();
    await expect(count(`${one.name} (2)`)).toBeVisible();
    await screenshot(page, 'level-beginner-selected');
  });

  await test.step('two values of one facet are OR', async () => {
    await open({ levels: ['beginner', 'advanced'] });
    await expect(page.getByText('3 courses')).toBeVisible();
    await expect(count('Intermediate (1)')).toBeVisible();
  });

  await test.step('two facets together are AND', async () => {
    await open({ levels: ['beginner'], languages: ['en'] });
    await expect(page.getByText('1 course', { exact: true })).toBeVisible();
    await expect(count('French (1)')).toBeVisible();
    await expect(count('Intermediate (1)')).toBeVisible();
    await screenshot(page, 'level-and-language-selected');
  });

  await test.step('a tag filter counts the other facets inside it', async () => {
    await open({ tags: [sqlTag] });
    await expect(page.getByText('2 courses')).toBeVisible();
    await expect(count('Beginner (1)')).toBeVisible();
    await expect(count('Advanced (1)')).toBeVisible();
  });

  await test.step('a text query and a filter together', async () => {
    await open({ levels: ['advanced'] });
    await page.goto(`${page.url()}&query=${encodeURIComponent('Facet')}`);
    await expect(page.getByText('1 course', { exact: true })).toBeVisible();
  });
});
