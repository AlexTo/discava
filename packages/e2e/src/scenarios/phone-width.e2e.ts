/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { apiUser, createLongTitledCourseViaApi } from '../helpers/api.js';
import { screenshot } from '../helpers/screenshots.js';
import { enrolAndLand, openCourse } from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, uniqueName } from '../helpers/users.js';
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
