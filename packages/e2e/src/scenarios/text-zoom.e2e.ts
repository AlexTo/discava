/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { firefox } from '@playwright/test';
import { createCourse } from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// Text-only zoom at 200% (#1137, T088) is the browser's default font size
// doubled. Setting `<html>`'s font size from a script isn't the same: media
// queries measure rem against the browser's default size, so only the real
// setting moves Tailwind's `md` from 768px to 1536px, as it does for a person
// who zooms. Only Firefox lets a test set it.
test('the course editor and a dialog do not scroll sideways at 200% text zoom', async () => {
  const browser = await firefox.launch({
    firefoxUserPrefs: {
      'font.size.variable.x-western': 32,
      'font.size.fixed.x-western': 26,
    },
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    const title = uniqueName('Zoomed course');
    await page.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(page, newUser('Zed', ['instructor']));
    await createCourse(page, { title, summary: 'A course read at 200%.' });

    const zoom = await page.evaluate(() => ({
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      mdMatches: matchMedia('(min-width: 48rem)').matches,
    }));
    expect(zoom).toEqual({ rootFontSize: '32px', mdMatches: false });

    const expectNoSidewaysScroll = async () =>
      expect
        .poll(() =>
          page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(0);

    await expect(
      page.getByRole('button', { name: 'Open user menu' }),
    ).toBeVisible();
    await expectNoSidewaysScroll();
    await screenshot(page, 'course editor at real 200% text zoom');

    await page.getByRole('button', { name: 'New module' }).click();
    const dialog = page.getByRole('dialog', { name: 'New module' });
    await expect(
      dialog.getByRole('button', { name: 'Create module' }),
    ).toBeInViewport();
    await expectNoSidewaysScroll();
    await screenshot(page, 'new module dialog at real 200% text zoom');
  } finally {
    await browser.close();
  }
});
