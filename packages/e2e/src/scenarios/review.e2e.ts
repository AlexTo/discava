/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { apiUser } from '../helpers/api.js';
import { createUploadAssignmentCourse } from '../helpers/assignment.js';
import { screenshot } from '../helpers/screenshots.js';
import { enrol, openCourse } from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, uniqueName } from '../helpers/users.js';

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
