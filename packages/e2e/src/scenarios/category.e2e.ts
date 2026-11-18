/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { apiUser, createPublishedCourseViaApi } from '../helpers/api.js';
import {
  archiveCategory,
  createCategory,
  setCourseCatalogue,
} from '../helpers/catalogue.js';
import { createCourse } from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { expectAfterReloads } from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// An admin manages the category taxonomy in the admin portal; instructors are
// offered only the active categories, and no one else may call the API.
test('an admin creates, renames and archives a category', async ({
  browser,
}) => {
  const name = uniqueName('E2E category');
  const renamed = `${name} renamed`;
  const admin = await browser.newPage();
  const instructor = await browser.newPage();
  const row = (rowName: string) =>
    admin.getByRole('row', { name: new RegExp(rowName) });

  await test.step('the admin adds a category', async () => {
    await admin.goto(`${PORTALS.admin}/categories`);
    await signIn(admin, newUser('Cara', ['admin']));
    await expect(
      admin.getByRole('heading', { name: 'Categories' }),
    ).toBeVisible();
    await admin.getByLabel('New category name').fill(name);
    await admin.getByRole('button', { name: 'Add category' }).click();
    await expect(row(name)).toBeVisible();
    await expect(row(name)).toContainText('Active');
    await screenshot(admin, 'category-added');
  });

  await test.step('a duplicate name, ignoring case, is refused', async () => {
    await admin.getByLabel('New category name').fill(name.toUpperCase());
    await admin.getByRole('button', { name: 'Add category' }).click();
    await expect(admin.getByRole('alert')).toContainText('already exists');
    await screenshot(admin, 'category-duplicate-refused');
    await admin.getByLabel('New category name').fill('');
  });

  await test.step('an instructor is offered it', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ian', ['instructor']));
    await createCourse(instructor, {
      title: uniqueName('Category course'),
      summary: 'A course for the category scenario.',
    });
    await expect(
      instructor.getByLabel('Category').locator('option', { hasText: name }),
    ).toHaveCount(1);
  });

  await test.step('the admin renames it, and the slug stays', async () => {
    const slug = await row(name).locator('td').nth(1).innerText();
    await row(name).getByRole('button', { name: 'Rename' }).click();
    await admin.getByLabel(`New name for ${name}`).fill(renamed);
    await admin.getByRole('button', { name: 'Save' }).click();
    await expect(row(renamed)).toBeVisible();
    await expect(row(renamed)).toContainText(slug);
    await screenshot(admin, 'category-renamed');
  });

  await test.step('the admin archives it after confirming', async () => {
    await row(renamed).getByRole('button', { name: 'Archive' }).click();
    await screenshot(admin, 'category-archive-confirmation');
    await admin
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Archive' })
      .click();
    await expect(row(renamed)).toContainText('Archived');
    await screenshot(admin, 'category-archived');
  });

  await test.step('an instructor is no longer offered it', async () => {
    await instructor.reload();
    await expect(instructor.getByLabel('Category')).toBeVisible();
    await expect(
      instructor.getByLabel('Category').locator('option', { hasText: renamed }),
    ).toHaveCount(0);
  });
});

test('a caller outside the admin group is refused', async () => {
  for (const roles of [['student'], ['instructor']] as const) {
    const user = await apiUser('Nora', [...roles]);

    await expect(user.admin.category.list.query()).rejects.toMatchObject({
      data: { code: 'FORBIDDEN' },
    });
    await expect(
      user.admin.category.create.mutate({ name: uniqueName('Refused') }),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
  }
});

// A category's landing page lists exactly its published courses, with facets
// counted inside it. The index follows the table's stream by a few seconds.
test('a category landing page lists only its own courses', async ({ page }) => {
  const instructor = await apiUser('Lena', ['instructor']);
  const category = await createCategory(uniqueName('Landing'));
  const other = await createCategory(uniqueName('Landing other'));
  const titles = {
    beginner: uniqueName('Landing beginner'),
    advanced: uniqueName('Landing advanced'),
    elsewhere: uniqueName('Landing elsewhere'),
  };
  const publish = async (
    title: string,
    catalogue: Parameters<typeof setCourseCatalogue>[1],
  ) => {
    const { courseId } = await createPublishedCourseViaApi(instructor, title);
    await setCourseCatalogue(courseId, catalogue);
  };
  await publish(titles.beginner, {
    categoryId: category.categoryId,
    level: 'beginner',
  });
  await publish(titles.advanced, {
    categoryId: category.categoryId,
    level: 'advanced',
  });
  await publish(titles.elsewhere, {
    categoryId: other.categoryId,
    level: 'beginner',
  });

  await test.step('it lists all of the category’s courses and none from another', async () => {
    await expectAfterReloads(page, async () => {
      await page.goto(`${PORTALS.student}/category/${category.slug}`);
      await expect(page.getByText('2 courses')).toBeVisible({ timeout: 2_000 });
    });
    await expect(
      page.getByRole('heading', { name: category.name }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: titles.beginner }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: titles.advanced }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: titles.elsewhere }),
    ).toHaveCount(0);
    await screenshot(page, 'category-landing-page');
  });

  await test.step('facets are counted inside the category, with no category group', async () => {
    await expect(
      page.getByRole('checkbox', { name: 'Beginner (1)', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: 'Advanced (1)', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Landing/ })).toHaveCount(
      0,
    );
    await page.getByRole('checkbox', { name: 'Beginner (1)' }).check();
    await expect(page.getByText('1 course', { exact: true })).toBeVisible();
    await screenshot(page, 'category-landing-page-filtered');
  });

  await test.step('a made-up slug shows not found', async () => {
    await page.goto(
      `${PORTALS.student}/category/${uniqueName('nope').toLowerCase()}`,
    );
    await expect(
      page.getByRole('heading', { name: 'Category not found' }),
    ).toBeVisible();
    await screenshot(page, 'category-not-found');
  });

  await test.step('an archived category shows no longer available', async () => {
    await archiveCategory(category.categoryId);
    await page.goto(`${PORTALS.student}/category/${category.slug}`);
    await expect(
      page.getByRole('heading', {
        name: `${category.name} is no longer available`,
      }),
    ).toBeVisible();
    await screenshot(page, 'category-no-longer-available');
  });
});
