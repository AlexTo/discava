/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  apiUser,
  createLongTitledCourseViaApi,
  createPublishedCourseViaApi,
} from '../helpers/api.js';
import {
  apiUserFor,
  createUploadAssignmentCourse,
  uploadSubmissionFile,
} from '../helpers/assignment.js';
import { createCategory, setCourseCatalogue } from '../helpers/catalogue.js';
import { PORTALS } from '../helpers/portals.js';
import { coursePageUrl, setLandingViaApi } from '../helpers/public-pages.js';
import { screenshot } from '../helpers/screenshots.js';
import {
  enrolAndLand,
  expectAfterReloads,
  openCourse,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';
import { expectNoSidewaysScroll, PHONE } from '../helpers/viewport.js';

// The student portal on a small phone: pages fit the width, and nothing needed
// is pushed below the first screen.
test.use({ viewport: PHONE });

test('a lesson with long titles fits a phone', async ({ page }) => {
  const title = uniqueName('E2E phone course');
  const instructor = await apiUser('Ivy', ['instructor', 'student']);
  const { lessonTitles } = await createLongTitledCourseViaApi(
    instructor,
    title,
  );

  await openCourse(page, title);
  await enrolAndLand(page, newUser('Pia', ['student']));
  const lessonHeading = page.getByRole('heading', {
    level: 2,
    name: lessonTitles[0],
  });
  await expect(lessonHeading).toBeVisible();

  await test.step('nothing scrolls sideways, and the outline is closed', async () => {
    await expectNoSidewaysScroll(page);
    const outline = page.getByRole('button', { name: /^Course outline/ });
    await expect(outline).toBeVisible();
    await expect(outline).toHaveAttribute('aria-expanded', 'false');
  });

  await test.step('the lesson starts on the first screen', async () => {
    for (const locator of [
      lessonHeading,
      page.getByText("You're enrolled in"),
    ]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
        PHONE.height,
      );
    }
    await screenshot(page, 'lesson at phone width');
  });

  await test.step('the outline opens and leads to the second lesson', async () => {
    await page.getByRole('button', { name: /^Course outline/ }).click();
    await expectNoSidewaysScroll(page);
    await screenshot(page, 'outline open at phone width');
    await page
      .getByRole('navigation', { name: 'Course outline' })
      .getByRole('link', { name: new RegExp(lessonTitles[1] ?? '') })
      .click();
    const second = page.getByRole('heading', {
      level: 2,
      name: lessonTitles[1],
    });
    await expect(second).toBeVisible();
    // The outline closes again, so the lesson is the first thing on screen.
    await expect(
      page.getByRole('button', { name: /^Course outline/ }),
    ).toHaveAttribute('aria-expanded', 'false');
    const box = await second.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
      PHONE.height,
    );
    await expectNoSidewaysScroll(page);
  });
});

test('a course page with six section tabs fits a phone and scrolls its tabs', async ({
  page,
}) => {
  const title = uniqueName('E2E phone tabs course');
  const instructor = await apiUser('Ivy', ['instructor']);
  const { courseId } = await createPublishedCourseViaApi(instructor, title);
  await setLandingViaApi(instructor, courseId, {
    learningOutcomes: ['Read a wide tab bar'],
    requirements: ['A phone'],
  });

  await page.goto(coursePageUrl(courseId));
  await expect(
    page.getByRole('heading', { level: 1, name: title }),
  ).toBeVisible();
  const tabs = page.getByRole('navigation', { name: 'Course sections' });
  await expect(tabs.getByRole('link')).toHaveCount(6);

  await test.step('the page does not scroll sideways', async () => {
    await expectNoSidewaysScroll(page);
    await screenshot(page, 'course page with six tabs at phone width');
  });

  await test.step('the last tab can be scrolled into view and clicked', async () => {
    const last = tabs.getByRole('link', { name: 'Reviews' });
    await last.scrollIntoViewIfNeeded();
    await last.click();
    await expect(page).toHaveURL(`${coursePageUrl(courseId)}#reviews`);
    await expectNoSidewaysScroll(page);
  });
});

test('search and the user menu work on a phone for an instructor-student', async ({
  page,
}) => {
  const title = uniqueName('E2E phone search course');
  const instructor = await apiUser('Ivy', ['instructor', 'student']);
  await createPublishedCourseViaApi(instructor, title);

  await page.goto(PORTALS.student);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await signIn(page, newUser('Ines', ['instructor', 'student']));
  const menuButton = page.getByRole('button', { name: 'Open user menu' });
  await expect(menuButton).toBeVisible();

  await test.step('the top bar fits and the user menu is fully visible', async () => {
    await expectNoSidewaysScroll(page);
    const box = await menuButton.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(PHONE.width);
  });

  await test.step('the search box shows what is typed and the suggestions are wide', async () => {
    const search = page.getByRole('combobox', { name: 'Search courses' });
    await search.fill(title.slice(0, 20));
    const suggestions = page.getByRole('listbox', {
      name: 'Course suggestions',
    });
    await expect(suggestions).toBeVisible();
    expect((await search.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(
      150,
    );
    expect(
      (await suggestions.boundingBox())?.width ?? 0,
    ).toBeGreaterThanOrEqual(320);
    await screenshot(page, 'search suggestions at phone width');
    await search.fill('');
  });

  await test.step('the user menu starts with My Learning, then Instructor', async () => {
    await menuButton.click();
    const items = page.getByRole('menuitem');
    await expect(items.nth(0)).toHaveText('My Learning');
    await expect(items.nth(1)).toHaveText('Instructor');
    await screenshot(page, 'user menu at phone width');
  });
});

test('search results come first on a phone, with the filters collapsed', async ({
  page,
}) => {
  const title = uniqueName('E2E phone filter course');
  const instructor = await apiUser('Ivy', ['instructor']);
  const category = await createCategory(uniqueName('E2E phone category'));
  const { courseId } = await createPublishedCourseViaApi(instructor, title);
  await setCourseCatalogue(courseId, {
    categoryId: category.categoryId,
    level: 'beginner',
    language: 'en',
    durationHours: 3,
    tags: [uniqueName('phonetag').toLowerCase()],
  });

  const expectResultsFirst = async () => {
    const card = page.getByRole('link', { name: new RegExp(title) }).first();
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      PHONE.height,
    );
    await expectNoSidewaysScroll(page);
    await expect(
      page.getByRole('button', { name: /^Filters/ }),
    ).toHaveAttribute('aria-expanded', 'false');
  };

  await test.step('a search for the course shows it on the first screen', async () => {
    // The index follows the table's stream by up to a few seconds.
    await page.goto(
      `${PORTALS.student}/search?query=${encodeURIComponent(title)}`,
    );
    await expectAfterReloads(page, async () => {
      await expect(
        page.getByRole('link', { name: new RegExp(title) }),
      ).toBeVisible({
        timeout: 2_000,
      });
    });
    await expectResultsFirst();
    await screenshot(page, 'search results at phone width');
  });

  await test.step('the category page shows it on the first screen', async () => {
    await page.goto(`${PORTALS.student}/category/${category.slug}`);
    await expectResultsFirst();
  });

  await test.step('the filters open on request', async () => {
    await page.goto(
      `${PORTALS.student}/search?query=${encodeURIComponent(title)}`,
    );
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(
      page.getByRole('checkbox', { name: /^Beginner/ }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, 'filters open at phone width');
  });

  await test.step('a 70-character word does not push the page sideways', async () => {
    await page.goto(`${PORTALS.student}/search?query=${'a'.repeat(70)}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
});

test('a long description does not make a tall card on a phone', async ({
  page,
}) => {
  const scope = uniqueName('phonecards').toLowerCase();
  const instructor = await apiUser('Ivy', ['instructor']);
  const longTitle = uniqueName('E2E phone long description');
  const shortTitle = uniqueName('E2E phone short description');
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
  const tall = await card(longTitle).boundingBox();
  const small = await card(shortTitle).boundingBox();
  expect(tall?.height).toBeLessThanOrEqual((small?.height ?? 0) * 1.5);
  await expectNoSidewaysScroll(page);
  await screenshot(page, 'course cards at phone width');

  await card(longTitle).getByRole('link', { name: longTitle }).click();
  await expect(page).toHaveURL(new RegExp(`/learn/${long.courseId}`));
});

test('the grading queue on the instructor home page fits a phone with long names', async ({
  page,
}) => {
  const ivy = newUser('Ivy', ['instructor']);
  const instructor = await apiUserFor(ivy);
  const tess = await apiUser('Tess', ['student']);
  const long = await createUploadAssignmentCourse(instructor, {
    courseTitle: `${uniqueName('E2E phone queue course')} ${'x'.repeat(60)}`,
    assignmentTitle: `Assignment ${'y'.repeat(60)}`,
  });
  await tess.core.course.enrol.mutate({ courseId: long.courseId });
  await tess.core.assignment.submit.mutate(
    await uploadSubmissionFile(tess, long, 'a.txt', Buffer.from('a')),
  );

  await page.goto(`${PORTALS.instructor}/`);
  await signIn(page, ivy);
  const queue = page.getByRole('region', { name: 'Waiting for grading' });
  await expect(queue.getByRole('link')).toHaveCount(1);
  await expectNoSidewaysScroll(page);
  await screenshot(page, 'grading queue at phone width');
});
