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

// An instructor prices a draft course in the course editor, changes the
// price and clears it. A price needs payments connected, which the test
// sets up directly.
test('an instructor sets, changes and clears a course price', async ({
  browser,
}) => {
  const title = uniqueName('E2E priced course');
  await connectLocalPayments();
  const instructor = await browser.newPage();
  const price = instructor.getByLabel('Price', { exact: true });
  const save = instructor.getByRole('button', { name: 'Save price' });
  const saved = instructor.getByText('Saved', { exact: true });

  await test.step('the instructor opens a new, free course', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Dee', ['instructor']));
    await createCourse(instructor, {
      title,
      summary: 'A course priced by the end-to-end tests.',
    });
    await expect(price).toHaveValue('0');
    await screenshot(instructor, 'price-form-free');
  });

  await test.step('a price outside the rules is refused on the page', async () => {
    await price.fill('0.5');
    await save.click();
    await expect(instructor.getByRole('alert')).toContainText(
      'minimum 1.00, maximum 10,000.00',
    );
    await screenshot(instructor, 'price-form-refused');
  });

  await test.step('the instructor sets a price and currency', async () => {
    await price.fill('19.99');
    await instructor.getByLabel('Currency').selectOption('EUR');
    await save.click();
    await expect(saved).toBeVisible();
    await screenshot(instructor, 'price-form-saved');

    await instructor.reload();
    await expect(price).toHaveValue('19.99');
    await expect(instructor.getByLabel('Currency')).toHaveValue('EUR');
  });

  await test.step('the instructor changes it, then clears it', async () => {
    await price.fill('25');
    await save.click();
    await expect(saved).toBeVisible();
    await instructor.reload();
    await expect(price).toHaveValue('25.00');

    await price.fill('0');
    await save.click();
    await expect(saved).toBeVisible();
    await instructor.reload();
    await expect(price).toHaveValue('0');
  });
});
