/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { apiUser, createPublishedCourseViaApi } from '../helpers/api.js';
import {
  apiUserFor,
  createUploadAssignmentCourse,
  openSubmissionReview,
  openSubmissions,
  uploadSubmissionFile,
} from '../helpers/assignment.js';
import { createCategory, setCourseCatalogue } from '../helpers/catalogue.js';
import { PORTALS } from '../helpers/portals.js';
import { coursePageUrl } from '../helpers/public-pages.js';
import { screenshot } from '../helpers/screenshots.js';
import { enrolAndLand, expectAfterReloads } from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// The student portal's pages put their breadcrumb in the same place (#806):
// the same left edge and the same distance from the top, at desktop width.
test('the breadcrumb sits in the same place on the student pages that have one', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const title = uniqueName('E2E breadcrumb course');
  const instructor = await apiUser('Ivy', ['instructor']);
  const category = await createCategory(uniqueName('E2E breadcrumb category'));
  const { courseId } = await createPublishedCourseViaApi(instructor, title);
  await setCourseCatalogue(courseId, {
    categoryId: category.categoryId,
    level: 'beginner',
    language: 'en',
    durationHours: 3,
  });

  const breadcrumb = page.getByRole('navigation', { name: 'breadcrumb' });
  const places: Record<string, { x: number; y: number }> = {};
  const expectBreadcrumb = async (name: string) => {
    await expect(breadcrumb.first()).toBeVisible();
    const box = await breadcrumb.first().boundingBox();
    expect(box).not.toBeNull();
    places[name] = { x: box?.x ?? 0, y: box?.y ?? 0 };
  };

  await test.step('the marketing home and the course catalogue at desktop width', async () => {
    await page.goto(PORTALS.student);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await screenshot(page, 'marketing home at desktop width');
    await page.goto(`${PORTALS.student}/courses`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await screenshot(page, 'course catalogue at desktop width');
  });

  await test.step('search and the category page', async () => {
    await expectAfterReloads(page, async () => {
      await page.goto(
        `${PORTALS.student}/search?query=${encodeURIComponent(title)}`,
      );
      await expect(page.getByRole('link', { name: title })).toBeVisible({
        timeout: 2_000,
      });
    });
    await expectBreadcrumb('search');
    await screenshot(page, 'search breadcrumb at desktop width');

    await expectAfterReloads(page, async () => {
      await page.goto(`${PORTALS.student}/category/${category.slug}`);
      await expect(page.getByRole('link', { name: title })).toBeVisible({
        timeout: 2_000,
      });
    });
    await expectBreadcrumb('category');
    await screenshot(page, 'category breadcrumb at desktop width');
  });

  await test.step('the course page and the instructor profile', async () => {
    await page.goto(coursePageUrl(courseId));
    await expect(
      page.getByRole('heading', { level: 1, name: title }),
    ).toBeVisible();
    await expectBreadcrumb('course');
    await screenshot(page, 'course page breadcrumb at desktop width');

    await page
      .getByRole('region', { name: 'Instructors' })
      .getByRole('link', { name: 'View profile' })
      .click();
    await expect(page).toHaveURL(/\/instructors\//);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectBreadcrumb('instructor');
    await screenshot(
      page,
      'instructor profile with its breadcrumb at desktop width',
    );
  });

  await test.step('a lesson and My Learning, signed in', async () => {
    await page.goto(coursePageUrl(courseId));
    await enrolAndLand(page, newUser('Wes', ['student']));
    await expectBreadcrumb('lesson');
    await screenshot(page, 'lesson breadcrumb at desktop width');

    await page.goto(`${PORTALS.student}/my-learning`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'My Learning' }),
    ).toBeVisible();
    await expectBreadcrumb('my learning');
    await screenshot(page, 'my learning breadcrumb at desktop width');
  });

  await test.step('they all share a left edge', async () => {
    const lefts = Object.values(places).map((place) => place.x);
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(1);
  });
});

// The instructor portal's crumbs are words and lead to pages that exist; an
// unknown address gets a page inside the shell; the checklist's links stay on
// the course page.
test('the instructor portal breadcrumbs and links lead somewhere real', async ({
  page,
}) => {
  const ASSIGNMENT = 'Breadcrumb essay';
  const ivy = newUser('Ivy', ['instructor']);
  const sam = newUser('Sam', ['student']);
  const instructor = await apiUserFor(ivy);
  const samApi = await apiUserFor(sam);
  const ref = await createUploadAssignmentCourse(instructor, {
    courseTitle: uniqueName('E2E crumbs course'),
    assignmentTitle: ASSIGNMENT,
  });
  await samApi.core.course.enrol.mutate({ courseId: ref.courseId });
  await samApi.core.assignment.submit.mutate(
    await uploadSubmissionFile(samApi, ref, 'essay.docx', Buffer.from('docx')),
  );

  await test.step('a submission page has a trail of words', async () => {
    await page.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(page, ivy);
    await openSubmissions(page, ref, ASSIGNMENT);
    await openSubmissionReview(page, 'Sam');

    const trail = page.getByRole('navigation', { name: 'breadcrumb' });
    await expect(trail.getByText('Home', { exact: true })).toBeVisible();
    await expect(trail.getByText('My Courses')).toBeVisible();
    await expect(trail.getByText(ASSIGNMENT)).toBeVisible();
    await expect(trail.getByText('Sam')).toBeVisible();
    await expect(trail).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    await screenshot(page, 'breadcrumbs on a submission');

    // Anchors only: the current page's crumb has role "link" but no address.
    const hrefs = await trail
      .locator('a[href]')
      .evaluateAll((links) =>
        links.map((link) => (link as HTMLAnchorElement).href),
      );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      await page.goto(href);
      await expect(
        page.getByRole('heading', { level: 1 }).first(),
      ).not.toHaveText('Page not found');
    }
  });

  await test.step('Settings is not a link', async () => {
    await page.goto(`${PORTALS.instructor}/settings/notifications`);
    const trail = page.getByRole('navigation', { name: 'breadcrumb' });
    await expect(trail.getByText('Settings', { exact: true })).toBeVisible();
    // An anchor: a text-only crumb has role "link" too, but no address.
    await expect(
      trail.locator('a[href]').filter({ hasText: /^Settings$/ }),
    ).toHaveCount(0);
  });

  await test.step('an unknown address gets a page inside the shell', async () => {
    await page.goto(`${PORTALS.instructor}/no-such-page`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'breadcrumb' }),
    ).toBeVisible();
    await screenshot(page, 'page not found');
  });

  await test.step('the checklist links stay on the course page', async () => {
    const { courseId } = await instructor.instructor.course.create.mutate({
      title: uniqueName('E2E checklist course'),
    });
    await page.goto(`${PORTALS.instructor}/my-courses/${courseId}`);
    const links = page.getByRole('link', { name: /^Add it: / });
    await expect(links.first()).toBeVisible();
    const sections: Record<string, string> = {
      'Add it: Learning outcomes': 'landing-page',
      'Add it: Course image': 'course-image',
    };
    for (const [name, hash] of Object.entries(sections)) {
      await page.getByRole('link', { name }).click();
      await expect(page).toHaveURL(
        new RegExp(`/my-courses/${courseId}#${hash}$`),
      );
    }
  });
});
