/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  apiUser,
  createLongTitledCourseViaApi,
  createPublishedCourseViaApi,
} from '../helpers/api.js';
import { PORTALS } from '../helpers/portals.js';
import { coursePageUrl, setLandingViaApi } from '../helpers/public-pages.js';
import { screenshot } from '../helpers/screenshots.js';
import { enrolAndLand, openCourse } from '../helpers/student-portal.js';
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
