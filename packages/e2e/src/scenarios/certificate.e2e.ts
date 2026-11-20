/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CERTIFICATE_ID,
  certificateControl,
  completeCourse,
  downloadedPdfText,
  expectInCompleted,
  publishCertificateCourse,
  setCertificates,
} from '../helpers/certificate.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// Certificates of completion (#276): issued when a student completes a
// course, downloaded and shared from My Learning, verified by anyone, and
// switched on or off by the course's instructor.

test('a student completes a course, downloads their certificate and shares it', async ({
  browser,
}) => {
  const title = uniqueName('E2E certificate course');
  const learner = newUser('Sam', ['student']);
  const instructor = await browser.newPage();
  const student = await browser.newPage();
  const visitor = await (await browser.newContext()).newPage();
  let link = '';
  let certificateId = '';

  await test.step('an instructor publishes a course', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await publishCertificateCourse(instructor, title);
  });

  await test.step('a student completes it and My Learning shows the certificate', async () => {
    await completeCourse(student, title, learner);
    await student
      .getByRole('banner')
      .getByRole('link', { name: 'My Learning' })
      .click();
    await expectInCompleted(student, async () => {
      await expect(
        certificateControl(student).getByRole('button', {
          name: 'Download PDF',
        }),
      ).toBeVisible({ timeout: 2_000 });
    });
    await expect(
      certificateControl(student).getByRole('link', { name: 'View' }),
    ).toBeVisible();
  });

  await test.step('the PDF names the learner, the course and the certificate ID', async () => {
    const downloading = student.waitForEvent('download');
    await certificateControl(student)
      .getByRole('button', { name: 'Download PDF' })
      .click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^certificate-.+\.pdf$/);
    const text = await downloadedPdfText(download);
    expect(text).toContain(`${learner.givenName} ${learner.familyName}`);
    expect(text).toContain(title);
    const found = text.match(CERTIFICATE_ID);
    expect(found).not.toBeNull();
    certificateId = found![0];
    expect(download.suggestedFilename()).toContain(certificateId);
  });

  await test.step('Copy link gives a link anyone can open', async () => {
    await student
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: PORTALS.student,
      });
    await certificateControl(student)
      .getByRole('button', { name: 'Copy link' })
      .click();
    await expect(student.getByText('Link copied')).toBeVisible();
    link = await student.evaluate(() => navigator.clipboard.readText());
    expect(link).toBe(`${PORTALS.student}/certificates/${certificateId}`);
  });

  await test.step('a signed-out visitor sees the name, course, date and ID, and no email', async () => {
    await visitor.goto(link);
    await expect(
      visitor.getByRole('heading', {
        level: 1,
        name: `${learner.givenName} ${learner.familyName}`,
      }),
    ).toBeVisible();
    await expect(visitor.getByText(title)).toBeVisible();
    await expect(visitor.getByText(certificateId)).toBeVisible();
    // The completion date, in UTC as the PDF prints it.
    await expect(
      visitor.getByText(/^\d{1,2} [A-Z][a-z]+ \d{4}$/),
    ).toBeVisible();
    await screenshot(visitor, 'certificate-page');
    await expect(visitor.getByText(learner.email)).toHaveCount(0);
    await expect(visitor.getByText(learner.username)).toHaveCount(0);
  });

  await test.step('a changed ID finds no certificate', async () => {
    // Same length and alphabet, one character different.
    const last = certificateId.endsWith('0') ? '1' : '0';
    await visitor.goto(
      `${PORTALS.student}/certificates/${certificateId.slice(0, -1)}${last}`,
    );
    await expect(visitor.getByText('Certificate not found')).toBeVisible();
    await expect(visitor.getByText(title)).toHaveCount(0);
  });
});

test('a student adds their certificate to LinkedIn', async ({ browser }) => {
  const title = uniqueName('E2E certificate LinkedIn course');
  const instructor = await browser.newPage();
  const student = await browser.newPage();
  const other = await browser.newPage();
  const visitor = await (await browser.newContext()).newPage();
  let href = '';
  let certificateId = '';

  // The test never reaches LinkedIn.
  await student
    .context()
    .route('https://www.linkedin.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<h1>LinkedIn</h1>' }),
    );

  await test.step('a student completes a course and My Learning offers the LinkedIn link', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await publishCertificateCourse(instructor, title);
    await completeCourse(student, title, newUser('Sam', ['student']));
    await student
      .getByRole('banner')
      .getByRole('link', { name: 'My Learning' })
      .click();
    await expectInCompleted(student, async () => {
      await expect(
        certificateControl(student).getByRole('link', {
          name: 'Add to LinkedIn profile',
        }),
      ).toBeVisible({ timeout: 2_000 });
    });
    const link = certificateControl(student).getByRole('link', {
      name: 'Add to LinkedIn profile',
    });
    href = (await link.getAttribute('href')) ?? '';
    expect(href).toMatch(
      /^https:\/\/www\.linkedin\.com\/profile\/add\?startTask=CERTIFICATION_NAME/,
    );
    const params = new URL(href).searchParams;
    expect(params.get('name')).toBe(title);
    certificateId = params.get('certId') ?? '';
    expect(certificateId).toMatch(CERTIFICATE_ID);
    expect(params.get('certUrl')).toBe(
      `${PORTALS.student}/certificates/${certificateId}`,
    );
    await screenshot(student, 'certificate-add-to-linkedin');
  });

  await test.step('clicking it opens LinkedIn in a new tab and records the use', async () => {
    const opened = student.context().waitForEvent('page');
    const recorded = student.waitForResponse(
      (response) =>
        response.url().includes('certificate.recordLinkedInClick') &&
        response.status() === 200,
    );
    await certificateControl(student)
      .getByRole('link', { name: 'Add to LinkedIn profile' })
      .click();
    const tab = await opened;
    await tab.waitForLoadState();
    expect(tab.url()).toBe(href);
    await recorded;
  });

  await test.step('the owner sees the LinkedIn section on the certificate page', async () => {
    await student.goto(`${PORTALS.student}/certificates/${certificateId}`);
    await expect(
      student.getByRole('heading', {
        name: 'Add this certificate to your LinkedIn profile',
      }),
    ).toBeVisible();
    await expect(student.getByText('What LinkedIn asks for')).toBeVisible();
    await screenshot(student, 'certificate-owner-share');
  });

  await test.step('another student and a signed-out visitor do not', async () => {
    await other.goto(`${PORTALS.student}/my-learning`);
    await signIn(other, newUser('Oli', ['student']));
    await other.goto(`${PORTALS.student}/certificates/${certificateId}`);
    await expect(other.getByText(title)).toBeVisible();
    await expect(other.getByText('What LinkedIn asks for')).toHaveCount(0);

    await visitor.goto(`${PORTALS.student}/certificates/${certificateId}`);
    await expect(visitor.getByText(title)).toBeVisible();
    await expect(visitor.getByText('What LinkedIn asks for')).toHaveCount(0);
  });
});

test('an instructor turns certificates off and on for a course', async ({
  browser,
}) => {
  const title = uniqueName('E2E certificate switch course');
  const instructor = await browser.newPage();
  const first = await browser.newPage();
  const second = await browser.newPage();
  const third = await browser.newPage();
  let courseUrl = '';
  let firstLink = '';

  await test.step('an instructor publishes a course and a first student completes it', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    courseUrl = await publishCertificateCourse(instructor, title);
    await completeCourse(first, title, newUser('Fay', ['student']));
    await first.goto(`${PORTALS.student}/my-learning`);
    await expectInCompleted(first, async () => {
      await expect(
        certificateControl(first).getByRole('link', { name: 'View' }),
      ).toBeVisible({ timeout: 2_000 });
    });
    firstLink =
      (await certificateControl(first)
        .getByRole('link', { name: 'View' })
        .getAttribute('href')) ?? '';
    expect(firstLink).toMatch(/^\/certificates\//);
  });

  await test.step('with certificates off, a second student gets none', async () => {
    await setCertificates(instructor, courseUrl, false);
    await completeCourse(second, title, newUser('Sid', ['student']));
    await second.goto(`${PORTALS.student}/my-learning`);
    // The course is completed, and by then its certificate would have been
    // issued, so this waits on the course rather than on the control.
    await expectInCompleted(second, async () => {
      await expect(
        second.getByRole('link', { name: `Review: ${title}` }),
      ).toBeVisible({ timeout: 2_000 });
    });
    await expect(certificateControl(second)).toHaveCount(0);
  });

  await test.step("the first student's certificate still verifies", async () => {
    await first.goto(`${PORTALS.student}${firstLink}`);
    // Scoped to the certificate: its owner's LinkedIn section lists the title too.
    await expect(
      first
        .getByRole('region', { name: 'Certificate of completion' })
        .getByText(title),
    ).toBeVisible();
    await expect(first.getByText('Certificate not found')).toHaveCount(0);
  });

  await test.step('with certificates on again, a third student gets one', async () => {
    await setCertificates(instructor, courseUrl, true);
    await completeCourse(third, title, newUser('Tia', ['student']));
    await third.goto(`${PORTALS.student}/my-learning`);
    await expectInCompleted(third, async () => {
      await expect(
        certificateControl(third).getByRole('link', { name: 'View' }),
      ).toBeVisible({ timeout: 2_000 });
    });
  });
});
