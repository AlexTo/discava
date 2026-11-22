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
  suggestInSiteSearch,
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

// Suggestions under the search box (#587): the same index as course.publicSearch,
// so a published course takes a few seconds to appear and to go, and the
// check reloads until it does.
test('suggestions offer a published course by the start of its title', async ({
  page,
}) => {
  const title = uniqueName('Suggestible course');
  // The first word and the start of the next, as someone typing would stop.
  const [first, second] = title.split(' ');
  const typed = `${first} ${second?.slice(0, 3)}`;
  const instructor = await apiUser('Sue', ['instructor']);
  const { courseId } = await createPublishedCourseViaApi(instructor, title);
  await instructor.instructor.course.create.mutate({
    title: `${title} draft`,
  });

  await test.step('it is offered, and a draft with the same start is not', async () => {
    await page.goto(PORTALS.student);
    await expectAfterReloads(page, async () => {
      const suggestions = await suggestInSiteSearch(page, typed);
      await expect(
        suggestions.getByRole('option', { name: title, exact: true }),
      ).toBeVisible({ timeout: 2_000 });
    });
    await expect(
      page
        .getByRole('listbox', { name: 'Course suggestions' })
        .getByRole('option', { name: `${title} draft` }),
    ).toHaveCount(0);
    await screenshot(page, 'search-suggestions-open');
  });

  await test.step('choosing it opens the course page', async () => {
    await page
      .getByRole('listbox', { name: 'Course suggestions' })
      .getByRole('option', { name: title, exact: true })
      .click();
    await page.waitForURL(new RegExp(`/learn/${courseId}`));
    await expect(
      page.getByRole('heading', { level: 1, name: title }),
    ).toBeVisible();
    await screenshot(page, 'search-suggestion-course-page');
  });

  await test.step('the keyboard alone picks a suggestion, and Escape closes the list', async () => {
    await page.goto(PORTALS.student);
    const box = page.getByRole('combobox', { name: 'Search courses' });
    const suggestions = await suggestInSiteSearch(page, typed);
    const option = suggestions.getByRole('option', {
      name: title,
      exact: true,
    });
    await expect(option).toBeVisible();
    for (let presses = 0; presses < 10; presses++) {
      if ((await option.getAttribute('aria-selected')) === 'true') break;
      await box.press('ArrowDown');
    }
    await expect(option).toHaveAttribute('aria-selected', 'true');
    await expect(box).toHaveAttribute('aria-activedescendant', /.+/);
    await screenshot(page, 'search-suggestions-keyboard');
    await box.press('Enter');
    await page.waitForURL(new RegExp(`/learn/${courseId}`));
    await expect(
      page.getByRole('heading', { level: 1, name: title }),
    ).toBeVisible();

    await page.goto(PORTALS.student);
    await suggestInSiteSearch(page, typed);
    await box.press('Escape');
    await expect(
      page.getByRole('listbox', { name: 'Course suggestions' }),
    ).toBeHidden();
    await expect(box).toHaveValue(typed);
  });

  await test.step('with no match it says so, and "See all results" opens the results', async () => {
    const nonsense = uniqueName('zzq');
    await page.goto(PORTALS.student);
    const suggestions = await suggestInSiteSearch(page, nonsense);
    await expect(
      page
        .getByTestId('site-search-suggestions')
        .getByText('No courses match', { exact: true }),
    ).toBeVisible();
    await screenshot(page, 'search-suggestions-empty');
    await suggestions
      .getByRole('option', { name: /^See all results for/ })
      .click();
    await page.waitForURL(/\/search\?query=/);
  });

  await test.step('archiving it removes it from the suggestions', async () => {
    await instructor.instructor.course.archive.mutate({ courseId });
    await expect(async () => {
      await page.goto(PORTALS.student);
      await page.getByRole('combobox', { name: 'Search courses' }).fill(typed);
      // Past the pause, so a suggestion would be showing by now.
      await page.waitForTimeout(1_000);
      await expect(
        page.getByRole('option', { name: title, exact: true }),
      ).toHaveCount(0);
    }).toPass({ timeout: 30_000 });
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

  await test.step('toggling a filter by keyboard keeps the focus on it', async () => {
    await open();
    await expect(page.getByText('4 courses')).toBeVisible();
    const beginner = count('Beginner (2)');
    await beginner.focus();
    await page.keyboard.press('Space');
    await expect(page.getByText('2 courses')).toBeVisible();
    await expect(count('Beginner (2)')).toBeChecked();
    await expect(count('Beginner (2)')).toBeFocused();

    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    // The scope tag was checked from the start; with Beginner and the next
    // checkbox that makes three, the last of them focused.
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(3);
    await expect(
      page.getByRole('checkbox', { checked: true }).and(page.locator(':focus')),
    ).toHaveCount(1);
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

// Ratings in search: three courses sharing a tag, one rated 5 and 4 by two
// students (average 4.5), one rated 2, one unrated. The rating reaches the
// index through the stream, so each check keeps looking for a few seconds.
test('search sorts and filters courses by their ratings', async ({ page }) => {
  const scope = uniqueName('rated').toLowerCase();
  const instructor = await apiUser('Rhea', ['instructor']);
  const publish = async (label: string) => {
    const title = uniqueName(`Rated ${label}`);
    const { courseId } = await createPublishedCourseViaApi(instructor, title);
    await setCourseCatalogue(courseId, { tags: [scope] });
    return { courseId, title };
  };
  const best = await publish('best');
  const poor = await publish('poor');
  const unrated = await publish('unrated');

  const review = async (
    givenName: string,
    ratings: { courseId: string; rating: number }[],
  ) => {
    const student = await apiUser(givenName, ['student']);
    for (const { courseId, rating } of ratings) {
      await student.core.course.enrol.mutate({ courseId });
      await student.core.review.post.mutate({ courseId, rating });
    }
  };
  await review('Sid', [
    { courseId: best.courseId, rating: 5 },
    { courseId: poor.courseId, rating: 2 },
  ]);
  await review('Sue', [{ courseId: best.courseId, rating: 4 }]);

  const open = (params: Record<string, string> = {}) =>
    page.goto(
      `${PORTALS.student}/search?${new URLSearchParams({
        tags: JSON.stringify([scope]),
        ...params,
      })}`,
    );
  // The result cards in order, by their title links.
  const titles = () =>
    page
      .locator('main a[href^="/learn/"]')
      .evaluateAll((links) => links.map((link) => link.textContent?.trim()));

  await test.step('every course shows its rating or that it has none', async () => {
    await expectAfterReloads(page, async () => {
      await open();
      await expect(page.getByText('4.5', { exact: true })).toBeVisible({
        timeout: 2_000,
      });
    });
    await expect(page.getByText('(2 ratings)')).toBeVisible();
    await expect(page.getByText('(1 rating)')).toBeVisible();
    await expect(page.getByText('No ratings yet')).toBeVisible();
    await screenshot(page, 'search-results-with-ratings');
  });

  await test.step('Highest rated puts the best first and the unrated last', async () => {
    await open({ sort: 'rating' });
    await expect(page.getByLabel('Sort by')).toHaveValue('rating');
    await expect.poll(titles).toEqual([best.title, poor.title, unrated.title]);
    await screenshot(page, 'search-sorted-by-highest-rated');
  });

  await test.step('a minimum rating drops the lower and the unrated', async () => {
    await open({ minRating: '4' });
    await expect(page.getByLabel('Minimum rating')).toHaveValue('4');
    await expect(page.getByText('1 course', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: best.title })).toBeVisible();
    await expect(page.getByRole('link', { name: poor.title })).toHaveCount(0);
    await screenshot(page, 'search-minimum-rating-4');
  });

  await test.step('choosing from the selects changes the address', async () => {
    await open();
    await page.getByLabel('Sort by').selectOption('rating');
    await expect(page).toHaveURL(/sort=rating/);
    await page.getByLabel('Minimum rating').selectOption('3');
    await expect(page).toHaveURL(/minRating=3/);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).not.toHaveURL(/sort=|minRating=/);
  });
});

test('a long description is cut to three lines, and a card opens from its title', async ({
  page,
}) => {
  const scope = uniqueName('cards').toLowerCase();
  const instructor = await apiUser('Cora', ['instructor']);
  const longTitle = uniqueName('Long description');
  const shortTitle = uniqueName('Short description');
  const long = await createPublishedCourseViaApi(
    instructor,
    longTitle,
    'A long description of the course. '.repeat(15).slice(0, 500),
  );
  const short = await createPublishedCourseViaApi(
    instructor,
    shortTitle,
    'One line.',
  );
  await setCourseCatalogue(long.courseId, { tags: [scope] });
  await setCourseCatalogue(short.courseId, { tags: [scope] });

  await page.goto(
    `${PORTALS.student}/search?${new URLSearchParams({ tags: JSON.stringify([scope]) })}`,
  );
  const card = (title: string) =>
    page.locator('[data-slot="card"]').filter({ hasText: title });
  await expectAfterReloads(page, async () => {
    await expect(card(longTitle)).toBeVisible({ timeout: 2_000 });
    await expect(card(shortTitle)).toBeVisible({ timeout: 2_000 });
  });

  await test.step('the taller card is at most 1.5 times the shorter', async () => {
    const tall = await card(longTitle).boundingBox();
    const small = await card(shortTitle).boundingBox();
    expect(tall?.height).toBeLessThanOrEqual((small?.height ?? 0) * 1.5);
    await screenshot(page, 'course cards');
  });

  await test.step('clicking a card’s title opens the course', async () => {
    await page.getByRole('link', { name: longTitle }).click();
    await expect(page).toHaveURL(new RegExp(`/learn/${long.courseId}`));
  });
});
