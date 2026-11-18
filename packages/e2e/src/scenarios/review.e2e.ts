/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { apiUser, createPublishedCourseViaApi } from '../helpers/api.js';
import { createUploadAssignmentCourse } from '../helpers/assignment.js';
import {
  addLesson,
  addModule,
  addTextItem,
  createCourse,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { enrol, openCourse } from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// Ratings and reviews on the course page: a signed-out visitor sees the
// section, an enrolled student posts, edits and deletes their review.
test.describe('course reviews in the student portal', () => {
  test('a student posts, edits and deletes a review', async ({ page }) => {
    const instructor = await apiUser('Ivy', ['instructor']);
    const title = uniqueName('E2E reviews course');
    await createUploadAssignmentCourse(instructor, {
      courseTitle: title,
      assignmentTitle: 'Essay',
    });

    await openCourse(page, title);
    await expect(page.getByText('No reviews yet')).toBeVisible();
    await screenshot(page, 'reviews section for a signed-out visitor');

    await enrol(page, newUser('Sam', ['student']));
    await page.goto(page.url().replace(/\/home$/, ''));
    await expect(
      page.getByText('Be the first to review this course'),
    ).toBeVisible();

    await page.getByRole('radio', { name: '4 stars' }).click();
    await page.getByLabel(/Your review/).fill('Clear and well paced.');
    await screenshot(page, 'the review form filled in');
    await page.getByRole('button', { name: 'Post review' }).click();

    await expect(page.getByText('Your review', { exact: true })).toBeVisible();
    await expect(page.getByText('(1 rating)')).toBeVisible();
    await screenshot(page, 'the review after posting');

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('radio', { name: '5 stars' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/· edited/).first()).toBeVisible();
    await screenshot(page, 'the review after editing');

    await page.getByRole('button', { name: 'Delete review' }).click();
    await screenshot(page, 'confirming deleting the review');
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete review' })
      .click();
    await expect(page.getByText('No ratings yet')).toBeVisible();
    await screenshot(page, 'the section after deleting the review');
  });
});

// The instructor portal's Reviews screen: answering a student's review.
test.describe('course reviews in the instructor portal', () => {
  test('an instructor responds to a review, edits the response and deletes it', async ({
    page,
  }) => {
    const course = uniqueName('E2E reviews respond');

    await page.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(page, newUser('Ivy', ['instructor']));
    await createCourse(page, {
      title: course,
      summary: 'A course whose reviews the end-to-end tests answer.',
    });
    await addModule(page, 'Module one');
    await addLesson(page, 'Lesson one');
    await addTextItem(page, { title: 'Reading', body: 'Text.' });
    await publishCourse(page);
    const courseId = page.url().split('/').pop()!;

    await page.getByRole('link', { name: 'Reviews', exact: true }).click();
    await expect(page.getByText('No reviews yet.')).toBeVisible();
    await screenshot(page, 'the reviews screen with no reviews');

    const student = await apiUser('Sam', ['student']);
    await student.core.course.enrol.mutate({ courseId });
    await student.core.review.post.mutate({
      courseId,
      rating: 4,
      text: 'Clear and well paced.',
    });
    await page.reload();
    await expect(page.getByText('Clear and well paced.')).toBeVisible();
    await expect(page.getByText('1 rating')).toBeVisible();
    await screenshot(page, 'a review waiting for a response');

    await page.getByRole('button', { name: /^Respond to .* review$/ }).click();
    await page
      .getByRole('textbox', { name: 'Response', exact: true })
      .fill('Thanks, Sam!');
    await screenshot(page, 'the response dialog');
    await page.getByRole('button', { name: 'Save response' }).click();
    await expect(page.getByText('Thanks, Sam!')).toBeVisible();
    await screenshot(page, 'the review with the response');

    await page
      .getByRole('button', { name: /^Edit response to .* review$/ })
      .click();
    await page
      .getByRole('textbox', { name: 'Response', exact: true })
      .fill('Thanks, Sam, glad it helped.');
    await page.getByRole('button', { name: 'Save response' }).click();
    await expect(page.getByText('Thanks, Sam, glad it helped.')).toBeVisible();

    await page
      .getByRole('button', { name: /^Delete response to .* review$/ })
      .click();
    await screenshot(page, 'confirming deleting the response');
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete response' })
      .click();
    await expect(page.getByText('Thanks, Sam, glad it helped.')).toBeHidden();
    await expect(
      page.getByRole('button', { name: /^Respond to .* review$/ }),
    ).toBeVisible();
  });
});

// The admin portal's Reviews screen: removing a review that breaks the rules.
test.describe('course reviews in the admin portal', () => {
  test('an admin removes a review with a reason', async ({ page }) => {
    const title = uniqueName('E2E reviews removal');
    const instructor = await apiUser('Ivy', ['instructor']);
    const { courseId } = await createPublishedCourseViaApi(instructor, title);
    const student = await apiUser('Sam', ['student']);
    await student.core.course.enrol.mutate({ courseId });
    await student.core.review.post.mutate({
      courseId,
      rating: 1,
      text: 'Rude words about the instructor.',
    });

    await page.goto(`${PORTALS.admin}/reviews`);
    await signIn(page, newUser('Cara', ['admin']));
    await expect(page.getByRole('heading', { name: 'Reviews' })).toBeVisible();
    await page
      .getByLabel('Course')
      .selectOption({ label: `${title} · 1 rating` });
    await expect(
      page.getByText('Rude words about the instructor.'),
    ).toBeVisible();
    await screenshot(page, 'the admin reviews screen with a visible review');

    await page.getByRole('button', { name: /^Remove .* review$/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('button', { name: 'Remove review' }),
    ).toBeDisabled();
    await dialog.getByLabel('Reason').fill('Abusive language');
    await screenshot(page, 'the removal dialog with a reason');
    await dialog.getByRole('button', { name: 'Remove review' }).click();

    await expect(page.getByText('Removed', { exact: true })).toBeVisible();
    await expect(page.getByText('Abusive language')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^Remove .* review$/ }),
    ).toBeHidden();
    await screenshot(page, 'the review marked removed with its reason');

    // The student can't post again, and the course's rating no longer counts it.
    await expect(
      student.core.review.post.mutate({ courseId, rating: 5 }),
    ).rejects.toThrow();
    await page.reload();
    await expect(
      page.getByRole('option', { name: `${title} · 0 ratings` }),
    ).toHaveCount(1);
  });
});
