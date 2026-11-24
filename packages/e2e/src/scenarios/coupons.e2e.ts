/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { connectLocalPayments } from '../helpers/api.js';
import { createCourse } from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// An instructor makes discount codes for a paid course on its Coupons screen,
// limits one, disables it, and deletes an unused one. A free course has
// nothing to discount.
test('an instructor manages discount codes on the Coupons screen', async ({
  browser,
}) => {
  const title = uniqueName('E2E coupon course');
  await connectLocalPayments();
  const instructor = await browser.newPage();
  const code = `E2E${Date.now().toString(36).toUpperCase()}`.slice(0, 12);

  await test.step('a free course asks for a price first', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Cora', ['instructor']));
    await createCourse(instructor, {
      title,
      summary: 'A course discounted by the end-to-end tests.',
    });
    await instructor.getByRole('link', { name: 'Coupons' }).click();
    await expect(
      instructor.getByText('Set a price on this course to create codes'),
    ).toBeVisible();
    await expect(
      instructor.getByRole('button', { name: 'Create code' }),
    ).toHaveCount(0);
    await screenshot(instructor, 'coupons-free-course');
  });

  await test.step('a paid course shows no codes yet', async () => {
    await instructor.getByRole('link', { name: 'Back to course' }).click();
    await instructor.getByLabel('Price', { exact: true }).fill('20');
    await instructor.getByRole('button', { name: 'Save price' }).click();
    await expect(instructor.getByText('Saved', { exact: true })).toBeVisible();
    await instructor.getByRole('link', { name: 'Coupons' }).click();
    await expect(instructor.getByText('No codes yet')).toBeVisible();
    await expect(
      instructor
        .getByRole('navigation', { name: 'breadcrumb' })
        .getByText('Coupons', { exact: true }),
    ).toBeVisible();
    await screenshot(instructor, 'coupons-breadcrumb');
    await screenshot(instructor, 'coupons-empty');
  });

  await test.step('the instructor creates a code', async () => {
    await instructor.getByRole('button', { name: 'Create code' }).click();
    const dialog = instructor.getByRole('dialog');
    await dialog.getByLabel('Code (optional)').fill(code);
    await dialog.getByLabel('Percent', { exact: true }).fill('25');
    await dialog.getByLabel('Maximum redemptions (optional)').fill('10');
    await screenshot(instructor, 'coupons-create-dialog');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(instructor.getByText(code, { exact: true })).toBeVisible();
    await expect(instructor.getByText(/25% off/)).toBeVisible();
    await expect(instructor.getByText(/0 of 10 used/)).toBeVisible();
    await expect(instructor.getByText('Active', { exact: true })).toBeVisible();
    await screenshot(instructor, 'coupons-list');
  });

  await test.step('the same code is refused on the Code field', async () => {
    await instructor.getByRole('button', { name: 'Create code' }).click();
    const dialog = instructor.getByRole('dialog');
    await dialog.getByLabel('Code (optional)').fill(code);
    await dialog.getByLabel('Percent', { exact: true }).fill('10');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(
      dialog.getByText('This code already exists for the course'),
    ).toBeVisible();
    await screenshot(instructor, 'coupons-duplicate-code');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  await test.step('the instructor changes the limit and disables the code', async () => {
    await instructor
      .getByRole('button', { name: `Edit limits for ${code}` })
      .click();
    const dialog = instructor.getByRole('dialog');
    await expect(dialog.getByText(/At least 0/)).toBeVisible();
    await dialog.getByLabel('Maximum redemptions').fill('5');
    await screenshot(instructor, 'coupons-edit-limits');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(instructor.getByText(/0 of 5 used/)).toBeVisible();

    await instructor.getByRole('button', { name: `Disable ${code}` }).click();
    await expect(
      instructor.getByText('Disabled', { exact: true }),
    ).toBeVisible();
    await screenshot(instructor, 'coupons-disabled');
    await instructor.getByRole('button', { name: `Enable ${code}` }).click();
    await expect(instructor.getByText('Active', { exact: true })).toBeVisible();
  });

  await test.step('an unused code is deleted after a confirmation', async () => {
    await instructor.getByRole('button', { name: `Delete ${code}` }).click();
    await screenshot(instructor, 'coupons-delete-confirm');
    await instructor.getByRole('button', { name: 'Delete code' }).click();
    await expect(instructor.getByText('No codes yet')).toBeVisible();
  });
});
