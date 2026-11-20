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
import {
  certificateCourseIdOf,
  emailsFor,
  fireCertificateReminder,
  localSubFor,
} from '../helpers/notification.js';
import { PAGE_RENDERER, PORTALS } from '../helpers/portals.js';
import { waitForQueuesToDrain } from '../helpers/router.js';
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

  await test.step("a certificate's page carries a social card", async () => {
    const response = await visitor.request.get(
      `${PAGE_RENDERER}/certificates/${certificateId}`,
    );
    expect(response.status()).toBe(200);
    const html = await response.text();
    const name = `${learner.givenName} ${learner.familyName}`;
    expect(html).toMatch(
      new RegExp(`property="og:title" content="[^"]*${name}[^"]*${title}`),
    );
    expect(html).toMatch(
      new RegExp(`property="og:description" content="[^"]*${certificateId}`),
    );
    expect(html).toContain('<meta name="robots" content="noindex" />');
    expect(response.headers()['x-robots-tag']).toBe('noindex');
    expect(html).not.toContain(learner.email);

    // A made-up ID answers 404 with none of the card.
    const last = certificateId.endsWith('0') ? '1' : '0';
    const missing = await visitor.request.get(
      `${PAGE_RENDERER}/certificates/${certificateId.slice(0, -1)}${last}`,
    );
    expect(missing.status()).toBe(404);
    const missingHtml = await missing.text();
    expect(missingHtml).not.toContain('og:title');
    expect(missingHtml).not.toContain(title);

    // The same address in the browser still draws the certificate.
    await visitor.goto(`${PAGE_RENDERER}/certificates/${certificateId}`);
    await expect(
      visitor.getByRole('heading', { level: 1, name }),
    ).toBeVisible();
    await expect(visitor.getByText(title)).toBeVisible();
    await screenshot(visitor, 'certificate-page-through-renderer');
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

test('a student is told about their certificate and adds it from the email', async ({
  browser,
}) => {
  const title = uniqueName('E2E certificate email course');
  const learner = newUser('Nia', ['student']);
  const instructor = await browser.newPage();
  const student = await browser.newPage();
  const signedOut = await browser.newContext();
  let certificateUrl = '';
  let linkedInUrl = '';

  await test.step('an instructor publishes a course and a student completes it', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await publishCertificateCourse(instructor, title);
    await completeCourse(student, title, learner);
  });

  await test.step('the bell tells them the certificate is ready', async () => {
    // The certificate and its notification land together a few seconds after
    // the last completion, so wait for the certificate first.
    await expectInCompleted(student, async () => {
      await expect(
        certificateControl(student).getByRole('link', { name: 'View' }),
      ).toBeVisible({ timeout: 2_000 });
    });
    await student
      .getByRole('button', { name: /^Notifications, \d+ unread$/ })
      .click();
    await expect(
      student.getByText(`Your certificate for ${title} is ready`),
    ).toBeVisible();
    await screenshot(student, 'certificate-issued-notification');
  });

  await test.step('one email carries the certificate and the LinkedIn address', async () => {
    await waitForQueuesToDrain();
    await expect
      .poll(async () => (await emailsFor(learner.email, title)).length, {
        timeout: 30_000,
      })
      .toBe(1);
    const [email] = await emailsFor(learner.email, title);
    certificateUrl = email!.text.match(
      new RegExp(`Open: (${PORTALS.student}/certificates/\\S+)`),
    )![1]!;
    linkedInUrl = email!.text.match(
      /Add to LinkedIn profile: (\S+\/linkedin\?source=issued-email)/,
    )![1]!;
    expect(certificateUrl).toMatch(CERTIFICATE_ID);
    expect(linkedInUrl).toBe(`${certificateUrl}/linkedin?source=issued-email`);
  });

  await test.step('signed out, the email’s address lands on LinkedIn’s form', async () => {
    const visitor = await signedOut.newPage();
    // The test never reaches LinkedIn.
    await signedOut.route('https://www.linkedin.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<h1>LinkedIn</h1>' }),
    );
    await visitor.goto(linkedInUrl);
    await visitor.waitForURL(/^https:\/\/www\.linkedin\.com\/profile\/add/);
    const params = new URL(visitor.url()).searchParams;
    expect(params.get('certId')).toBe(certificateUrl.split('/').pop());
    expect(params.get('name')).toBe(title);
    await screenshot(visitor, 'certificate-email-to-linkedin');
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

// The one reminder, three days after the certificate is issued, which the
// scenario fires itself (see fireCertificateReminder) instead of waiting.
test("a student who hasn't added their certificate gets one reminder", async ({
  browser,
}) => {
  const title = uniqueName('E2E certificate reminder course');
  const reminderTitle = `Add your ${title} certificate to LinkedIn`;
  const instructor = await browser.newPage();
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  const pageC = await browser.newPage();
  const studentA = newUser('Ada', ['student']);
  const studentB = newUser('Bea', ['student']);
  const studentC = newUser('Cy', ['student']);
  // How long a run that sends nothing is given to prove it.
  const QUIET_MS = 3_000;

  // The test never reaches LinkedIn.
  await pageB
    .context()
    .route('https://www.linkedin.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<h1>LinkedIn</h1>' }),
    );

  await test.step('an instructor publishes a course and three students complete it', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await publishCertificateCourse(instructor, title);
    await completeCourse(pageA, title, studentA);
    await completeCourse(pageB, title, studentB);
    await completeCourse(pageC, title, studentC);
  });

  await test.step('the first student gets one reminder, however often it runs', async () => {
    const userId = localSubFor(studentA.username);
    const courseId = await certificateCourseIdOf(userId);
    await fireCertificateReminder(userId, courseId);
    await waitForQueuesToDrain();
    await expect
      .poll(
        async () => (await emailsFor(studentA.email, reminderTitle)).length,
        { timeout: 30_000 },
      )
      .toBe(1);
    const [email] = await emailsFor(studentA.email, reminderTitle);
    expect(email!.text).toContain('source=reminder-email');

    await pageA.reload();
    await pageA
      .getByRole('button', { name: /^Notifications, \d+ unread$/ })
      .click();
    await expect(pageA.getByText(reminderTitle)).toHaveCount(1);
    await screenshot(pageA, 'certificate-reminder-notification');

    await fireCertificateReminder(userId, courseId);
    await pageA.waitForTimeout(QUIET_MS);
    await waitForQueuesToDrain();
    expect(await emailsFor(studentA.email, reminderTitle)).toHaveLength(1);
  });

  await test.step('a student who added it to LinkedIn first gets none', async () => {
    await pageB.goto(`${PORTALS.student}/my-learning`);
    await expectInCompleted(pageB, async () => {
      await expect(
        certificateControl(pageB).getByRole('link', {
          name: 'Add to LinkedIn profile',
        }),
      ).toBeVisible({ timeout: 2_000 });
    });
    const recorded = pageB.waitForResponse(
      (response) =>
        response.url().includes('certificate.recordLinkedInClick') &&
        response.status() === 200,
    );
    await certificateControl(pageB)
      .getByRole('link', { name: 'Add to LinkedIn profile' })
      .click();
    await recorded;

    const userId = localSubFor(studentB.username);
    await fireCertificateReminder(userId, await certificateCourseIdOf(userId));
    await pageB.waitForTimeout(QUIET_MS);
    await waitForQueuesToDrain();
    expect(await emailsFor(studentB.email, reminderTitle)).toHaveLength(0);
    await pageB.reload();
    await pageB
      .getByRole('button', { name: /^Notifications, \d+ unread$/ })
      .click();
    await expect(pageB.getByText(reminderTitle)).toHaveCount(0);
  });

  await test.step('a student with certificate emails off gets none', async () => {
    await pageC.goto(`${PORTALS.student}/my-learning`);
    await pageC.getByRole('button', { name: 'Open user menu' }).click();
    await pageC
      .getByRole('menuitem', { name: 'Notification settings' })
      .click();
    // One "Certificates" row covers the issued email and the reminder.
    await expect(
      pageC.getByRole('switch', { name: 'Certificates' }),
    ).toHaveCount(1);
    const toggle = pageC.getByRole('switch', { name: 'Certificates' });
    await toggle.click();
    await expect(pageC.getByText('Saved', { exact: true })).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await screenshot(pageC, 'certificate-email-setting');

    const userId = localSubFor(studentC.username);
    await fireCertificateReminder(userId, await certificateCourseIdOf(userId));
    await pageC.waitForTimeout(QUIET_MS);
    await waitForQueuesToDrain();
    expect(await emailsFor(studentC.email, reminderTitle)).toHaveLength(0);
    await pageC.goto(`${PORTALS.student}/my-learning`);
    await pageC
      .getByRole('button', { name: /^Notifications, \d+ unread$/ })
      .click();
    await expect(pageC.getByText(reminderTitle)).toHaveCount(0);
  });
});
