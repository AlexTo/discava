/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { apiUser, createPublishedCourseViaApi } from '../helpers/api.js';
import { type Brand, currentBrand, restoreBrand } from '../helpers/branding.js';
import { LOGO_SVG, SCRIPTED_LOGO_SVG, solidPng } from '../helpers/images.js';
import { PAGE_RENDERER, PORTALS } from '../helpers/portals.js';
import { coursePageUrl } from '../helpers/public-pages.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';
import { expectNoSidewaysScroll, PHONE } from '../helpers/viewport.js';

// An administrator uploads a logo and an icon on Settings → Branding and saves
// them; the portals' headers, the tab icon and a public course page then show
// them. The brand is one record for the whole stack, so the scenario runs
// serially and puts back what it found. Visitors see a change within five
// minutes in a deployed stage; locally the published copy is read fresh by a
// browser that has never visited, but a cached one may take up to a minute.
test.describe.configure({ mode: 'serial' });

const PORTAL_WAIT_MS = 90_000;

let admin: Awaited<ReturnType<typeof apiUser>>;
let before: Brand;

test.beforeAll(async () => {
  admin = await apiUser('Cara', ['admin']);
  before = await currentBrand(admin);
});

test.afterAll(async () => {
  await restoreBrand(admin, before);
});

const png = (name: string, width: number, height: number) => ({
  name,
  mimeType: 'image/png',
  buffer: solidPng(width, height),
});

test('an administrator uploads a logo and an icon, and visitors see them', async ({
  browser,
}) => {
  const page = await browser.newPage();

  await test.step('the Branding page starts from what is saved, with Save disabled', async () => {
    await page.goto(`${PORTALS.admin}/settings/branding`);
    await signIn(page, newUser('Cara', ['admin']));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Branding' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await screenshot(page, 'branding page before changes');
  });

  await test.step('a non-square icon is refused, with the rule, and nothing is uploaded', async () => {
    await page
      .getByLabel('Upload icon')
      .setInputFiles(png('icon.png', 512, 256));
    await expect(page.getByRole('alert')).toContainText('wrong shape');
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await screenshot(page, 'refused non-square icon');
  });

  await test.step('a logo and an icon upload and show in the preview', async () => {
    await page.getByLabel('Upload logo').setInputFiles({
      name: 'logo.svg',
      mimeType: 'image/svg+xml',
      buffer: LOGO_SVG,
    });
    await page
      .getByLabel('Upload icon')
      .setInputFiles(png('icon.png', 512, 512));
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
    await expect(
      page.getByRole('img', { name: /logo$/ }).last(),
    ).toHaveAttribute('src', /^blob:/);
    await screenshot(page, 'branding page with a new logo and icon');
  });

  await test.step('saving confirms, and the admin portal shows the logo at once', async () => {
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByText('Branding saved. Visitors see it within 5 minutes.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await expect(
      page.locator('header img[alt$=" logo"]').first(),
    ).toHaveAttribute('src', /brand\/logo\//);
    await screenshot(page, 'branding saved');
  });

  await test.step('the page fits a phone without scrolling sideways', async () => {
    const desktop = page.viewportSize();
    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, 'branding page at phone width');
    if (desktop) await page.setViewportSize(desktop);
  });

  await test.step('a scripted SVG logo is refused by the server, beside the logo', async () => {
    await page.getByLabel('Upload logo').setInputFiles({
      name: 'scripted.svg',
      mimeType: 'image/svg+xml',
      buffer: SCRIPTED_LOGO_SVG,
    });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/can't contain a <script>/)).toBeVisible();
    await screenshot(page, 'scripted logo refused');
  });

  await test.step('the stored brand still has the earlier logo', async () => {
    const saved = await currentBrand(admin);
    expect(saved.brand.logoKey).toMatch(/^brand\/logo\/.*\.svg$/);
    expect(saved.brand.iconKey).toMatch(/^brand\/icon\/.*\.png$/);
  });

  await test.step('the student and instructor portals show the logo and the tab icon', async () => {
    for (const [portal, url] of [
      ['student', PORTALS.student],
      ['instructor', PORTALS.instructor],
    ] as const) {
      const visitor = await browser.newPage();
      await visitor.goto(url);
      // The instructor portal has no signed-out view: it sends visitors to sign in.
      if (portal === 'instructor') {
        await signIn(visitor, newUser('Ian', ['instructor']));
      }
      // A first visit holds the render until brand.json arrives; a cached
      // copy may take up to a minute to give way to the new one.
      await expect(async () => {
        await visitor.reload();
        await expect(
          visitor.locator('header img[alt$=" logo"]').first(),
        ).toHaveAttribute('src', /brand\/logo\//, { timeout: 5_000 });
      }).toPass({ timeout: PORTAL_WAIT_MS });
      await expect(visitor.locator('link[rel="icon"]')).toHaveAttribute(
        'href',
        /brand\/icon\//,
      );
      await screenshot(visitor, `${portal} portal header with the brand`);
      await visitor.close();
    }
  });

  await test.step('a public course page carries the brand’s icon', async () => {
    const instructor = await apiUser('Pam', ['instructor']);
    const { courseId } = await createPublishedCourseViaApi(
      instructor,
      uniqueName('E2E branding course'),
    );
    await expect(async () => {
      const html = await (
        await fetch(`${PAGE_RENDERER}/learn/${courseId}`, {
          headers: { 'x-discava-host': new URL(coursePageUrl('x')).host },
        })
      ).text();
      expect(html).toMatch(
        /<link rel="icon" type="image\/png" href="[^"]*brand\/icon\//,
      );
      expect(html).toContain('rel="apple-touch-icon"');
      expect(html).toContain('id="discava-page-data"');
    }).toPass({ timeout: 30_000 });
  });

  await test.step('someone who is not an administrator is kept out, and cannot save', async () => {
    const student = await apiUser('Bob', ['student']);
    await expect(student.admin.branding.get.query()).rejects.toMatchObject({
      data: { code: 'FORBIDDEN' },
    });
    await expect(
      student.admin.branding.save.mutate({
        expectedRevision: 0,
        name: null,
        showNameBesideLogo: true,
        colour: null,
        logoKey: null,
        iconKey: null,
        shareImageKey: null,
      }),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });

    const outsider = await browser.newPage();
    await outsider.goto(`${PORTALS.admin}/settings/branding`);
    await signIn(outsider, newUser('Bob', ['student']));
    await expect(
      outsider.getByText('The admin portal is for administrators'),
    ).toBeVisible();
    await expect(
      outsider.getByRole('heading', { level: 1, name: 'Branding' }),
    ).toHaveCount(0);
  });
});

test('an administrator sets the platform name and share image, and visitors see them', async ({
  browser,
}) => {
  const page = await browser.newPage();
  const name = uniqueName('Acme Academy').slice(0, 50);

  await test.step('a blank name is refused, with its message, and Save is disabled', async () => {
    await page.goto(`${PORTALS.admin}/settings/branding`);
    await signIn(page, newUser('Cara', ['admin']));
    await page.getByLabel('Name', { exact: true }).fill('');
    await expect(page.getByRole('alert')).toContainText(
      'The name must be 1–50 characters.',
    );
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await screenshot(page, 'blank platform name refused');
  });

  await test.step('a small share image is refused, with the rule', async () => {
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page
      .getByLabel('Upload share image')
      .setInputFiles(png('small.png', 800, 420));
    await expect(page.getByRole('alert')).toContainText('too small');
    await screenshot(page, 'refused small share image');
  });

  await test.step('a valid share image uploads, and the name can be hidden beside the logo', async () => {
    await page
      .getByLabel('Upload share image')
      .setInputFiles(png('share.png', 1200, 630));
    await expect(
      page.getByRole('img', { name: 'Share image preview' }),
    ).toHaveAttribute('src', /^blob:/);
    await page.getByLabel('Show the name beside the logo').click();
    await screenshot(page, 'name and share image in the preview');
    await page.getByLabel('Show the name beside the logo').click();
  });

  await test.step('saving confirms, and the admin portal shows the name at once', async () => {
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByText('Branding saved. Visitors see it within 5 minutes.'),
    ).toBeVisible();
    await expect(page.locator('header').first()).toContainText(name);
    await screenshot(page, 'name and share image saved');
  });

  await test.step('a public course page carries the name and the share image', async () => {
    const instructor = await apiUser('Pam', ['instructor']);
    const { courseId } = await createPublishedCourseViaApi(
      instructor,
      uniqueName('E2E naming course'),
    );
    await expect(async () => {
      const html = await (
        await fetch(`${PAGE_RENDERER}/learn/${courseId}`, {
          headers: { 'x-discava-host': new URL(coursePageUrl('x')).host },
        })
      ).text();
      expect(html).toContain(`<meta property="og:site_name" content="${name}"`);
      expect(html).toMatch(/<title>[^<]* \| [^<]*<\/title>/);
      expect(html).toMatch(
        /<meta property="og:image" content="[^"]*brand\/share-image\//,
      );
    }).toPass({ timeout: 30_000 });
  });

  await test.step('the student portal’s tab title ends with the name', async () => {
    const visitor = await browser.newPage();
    await visitor.goto(PORTALS.student);
    await expect(async () => {
      await visitor.reload();
      await expect(visitor).toHaveTitle(new RegExp(name), { timeout: 5_000 });
    }).toPass({ timeout: PORTAL_WAIT_MS });
    await screenshot(visitor, 'student portal home with the platform name');
    await visitor.close();
  });

  await test.step('the student home’s copy puts the name in its own sentence', async () => {
    const visitor = await browser.newPage();
    await visitor.goto(PORTALS.student);
    await expect(
      visitor.getByText(
        `certificates you can share. ${name} brings your courses`,
      ),
    ).toBeVisible({ timeout: PORTAL_WAIT_MS });
    await screenshot(visitor, 'student home copy with the platform name');
    await visitor.close();
  });
});

test('an administrator chooses a brand colour, and a hard-to-read one is refused', async ({
  browser,
}) => {
  const page = await browser.newPage();
  await page.goto(`${PORTALS.admin}/settings/branding`);
  await signIn(page, newUser('Cara', ['admin']));

  await test.step('a colour that is hard to read is refused and Save stays disabled', async () => {
    await page.getByLabel('Hex colour').fill('#777777');
    await expect(page.getByRole('alert')).toContainText(
      'Text on this colour would be hard to read. Choose a darker or lighter shade.',
    );
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await screenshot(page, 'brand colour refused');
  });

  await test.step('a readable colour previews with light text, and only in the preview', async () => {
    await page.getByLabel('Hex colour').fill('#1d4ed8');
    await expect(page.getByText(/Text colour: light/)).toBeVisible();
    await expect(page.getByTestId('brand-preview')).toHaveCSS(
      '--primary',
      '#1d4ed8',
    );
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
    await screenshot(page, 'brand colour previewed');
  });

  await test.step('saving confirms', async () => {
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByText('Branding saved. Visitors see it within 5 minutes.'),
    ).toBeVisible();
    await screenshot(page, 'brand colour saved');
  });
});

test('an administrator resets the brand to the default', async ({
  browser,
}) => {
  const page = await browser.newPage();
  await page.goto(`${PORTALS.admin}/settings/branding`);
  await signIn(page, newUser('Cara', ['admin']));

  await test.step('a custom name and colour are saved', async () => {
    await page
      .getByLabel('Name', { exact: true })
      .fill(uniqueName('Acme').slice(0, 50));
    await page.getByLabel('Hex colour').fill('#1d4ed8');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByText('Branding saved. Visitors see it within 5 minutes.'),
    ).toBeVisible();
  });

  await test.step('resetting the colour alone keeps the name', async () => {
    await page.getByRole('button', { name: 'Reset colour to default' }).click();
    await expect(page.getByLabel('Hex colour')).toHaveValue('');
    await expect(page.getByLabel('Name', { exact: true })).not.toHaveValue(
      'Discava',
    );
    await screenshot(page, 'colour reset, name kept');
  });

  await test.step('reset all asks first, then puts every part back', async () => {
    await page.getByRole('button', { name: 'Reset all to default' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await screenshot(page, 'reset all confirmation');
    await page.getByRole('button', { name: 'Reset all' }).click();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
      'Discava',
    );
    await expect(page.getByLabel('Hex colour')).toHaveValue('');
    await screenshot(page, 'brand reset to default in the form');
  });

  await test.step('saving makes the reset take effect', async () => {
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByText('Branding saved. Visitors see it within 5 minutes.'),
    ).toBeVisible();
    await screenshot(page, 'default brand saved');
  });
});
