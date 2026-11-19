/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Page } from '@playwright/test';
import { apiUser, createPublishedCourseViaApi } from '../helpers/api.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { openCourse } from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, testUser, uniqueName } from '../helpers/users.js';

// Opens the course signed out, signs in as a new student and lands on the
// stand-in's hosted payment page, leaving the checkout open.
const startCheckout = async (page: Page, title: string, name: string) => {
  await openCourse(page, title);
  await page.getByRole('button', { name: 'Sign in to buy' }).click();
  await page
    .getByRole('dialog', { name: 'Sign in to buy' })
    .getByRole('link', { name: 'Continue to sign in' })
    .click();
  await signIn(page, newUser(name, ['student']));
  await page.getByRole('button', { name: 'Buy now' }).click();
  await page.waitForURL(/\/stripe\/pay\//);
};

// An administrator connects Stripe on the Payments page, replaces the key
// while a checkout is open, and cannot switch to another account until the
// checkout ends. Everyone else is refused. The "allowed after the window" and
// "old registration removed" steps are checked by hand (quickstart) and by
// unit tests with a fake clock: a short checkout life would break the other
// scenarios sharing the stack.
test('an administrator connects and rotates Stripe on the Payments page', async ({
  browser,
}) => {
  const title = uniqueName('E2E payments course');
  const admin = await browser.newPage();
  const keyField = admin.getByLabel('Stripe secret key');
  const instructor = await apiUser('Pam', ['instructor']);

  await test.step('Alice and Bob are refused, and see no Payments entry', async () => {
    const alice = await apiUser('Alice', ['instructor']);
    const bob = await apiUser('Bob', ['student']);
    for (const user of [alice, bob]) {
      await expect(user.admin.payment.status.query()).rejects.toMatchObject({
        data: { code: 'FORBIDDEN' },
      });
      await expect(
        user.admin.payment.connect.mutate({ secretKey: 'sk_test_local' }),
      ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
      await expect(
        user.admin.payment.disconnect.mutate(),
      ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    }
    const student = await browser.newPage();
    await student.goto(PORTALS.instructor);
    await signIn(student, newUser('Bob', ['student', 'instructor']));
    await expect(
      student.getByRole('link', { name: 'Payments', exact: true }),
    ).toHaveCount(0);
  });

  await test.step('Carol opens the Payments page', async () => {
    await admin.goto(`${PORTALS.admin}/payments`);
    await signIn(admin, testUser('Carol'));
    await expect(
      admin.getByRole('heading', { name: 'Payments' }),
    ).toBeVisible();
    await expect(
      admin.getByRole('link', { name: 'Payments', exact: true }),
    ).toBeVisible();
  });

  await test.step('a priced course cannot be priced before the connection', async () => {
    // A fresh state is not guaranteed: disconnect first when the page allows
    // it, otherwise skip this step.
    const disconnect = admin.getByRole('button', { name: 'Disconnect' });
    await expect(disconnect.or(keyField)).toBeVisible();
    if (await disconnect.isVisible()) {
      await disconnect.click();
      await admin
        .getByRole('dialog')
        .getByRole('button', { name: 'Disconnect Stripe' })
        .click();
      await expect(
        admin
          .getByText("Stripe isn't connected.", { exact: false })
          .or(admin.getByRole('alert')),
      ).toBeVisible();
    }
    if (await keyField.isVisible()) {
      await screenshot(admin, 'payments-not-connected');
      const { courseId } = await instructor.instructor.course.create.mutate({
        title: uniqueName('E2E unpriced course'),
      });
      await expect(
        instructor.instructor.course.setPrice.mutate({
          courseId,
          priceAmount: 1999,
          priceCurrency: 'USD',
        }),
      ).rejects.toMatchObject({ data: { code: 'PRECONDITION_FAILED' } });
    }
    // else: checkouts from other scenarios were open; nothing to check here.
  });

  await test.step('Carol connects with the test key', async () => {
    if (!(await keyField.isVisible())) {
      await admin.getByRole('button', { name: 'Replace key' }).click();
    }
    await keyField.fill('sk_test_local');
    await expect(keyField).toHaveAttribute('type', 'password');
    await admin
      .getByRole('button', { name: /Connect Stripe|Save key/ })
      .click();
    const confirm = admin.getByRole('dialog').getByRole('button', {
      name: 'Continue',
    });
    if (await confirm.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await confirm.click();
    }
    await expect(admin.getByText('Test mode')).toBeVisible();
    await expect(
      admin.getByText('Connected', { exact: true }).first(),
    ).toBeVisible();
    await expect(keyField).toHaveCount(0);
    await screenshot(admin, 'payments-connected');
  });

  const student = await browser.newPage();
  await test.step('a student starts a checkout for a priced course', async () => {
    const course = await createPublishedCourseViaApi(instructor, title);
    await instructor.instructor.course.setPrice.mutate({
      courseId: course.courseId,
      priceAmount: 1999,
      priceCurrency: 'USD',
    });
    await startCheckout(student, title, 'Sue');
  });

  await test.step('replacing the key with the same key mid-checkout is allowed', async () => {
    await admin.getByRole('button', { name: 'Replace key' }).click();
    await keyField.fill('sk_test_local');
    await admin.getByRole('button', { name: 'Save key' }).click();
    await admin
      .getByRole('dialog')
      .getByRole('button', { name: 'Continue' })
      .click();
    await expect(keyField).toHaveCount(0);
    await expect(admin.getByRole('alert')).toHaveCount(0);
  });

  await test.step('the open checkout still finishes', async () => {
    await student.getByRole('button', { name: 'Pay', exact: true }).click();
    await student.waitForURL(/checkout=success/);
    await expect(student.getByText('Enrolled', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step('another account is refused while a checkout is open', async () => {
    // A second checkout, left open.
    const second = await browser.newPage();
    await startCheckout(second, title, 'Tom');

    await admin.getByRole('button', { name: 'Replace key' }).click();
    await keyField.fill('sk_test_local_2');
    await admin.getByRole('button', { name: 'Save key' }).click();
    await admin
      .getByRole('dialog')
      .getByRole('button', { name: 'Continue' })
      .click();
    await expect(admin.getByRole('alert')).toContainText(
      'Checkouts are open until',
    );
    await expect(keyField).toHaveValue('');
    await screenshot(admin, 'payments-switch-refused');
  });
});
