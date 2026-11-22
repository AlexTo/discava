/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { apiUserFor } from '../helpers/assignment.js';
import {
  certificateControl,
  completeCourse,
  courseCertificates,
  expectInCompleted,
  publishCertificateCourse,
  revokedCertificateText,
} from '../helpers/certificate.js';
import { certificateCourseIdOf, localSubFor } from '../helpers/notification.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// Revoking a certificate (#594): the instructor revokes it, and the public
// page, the student's screens and the PDF all stop treating it as valid;
// restoring it brings the same certificate back.

test('a revoked certificate stops verifying for learners and verifiers, and a restored one verifies again', async ({
  browser,
}) => {
  const title = uniqueName('E2E revocation course');
  const learner = newUser('Rae', ['student']);
  const ivy = newUser('Ivy', ['instructor']);
  const instructorPage = await browser.newPage();
  const student = await browser.newPage();
  const visitor = await (await browser.newContext()).newPage();
  let courseId = '';
  let certificateId = '';

  await test.step('a student earns a certificate', async () => {
    await instructorPage.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructorPage, ivy);
    await publishCertificateCourse(instructorPage, title);
    await completeCourse(student, title, learner);
    courseId = await certificateCourseIdOf(localSubFor(learner.username));
  });

  await test.step('the instructor revokes it', async () => {
    const instructor = await apiUserFor(ivy);
    const [listed] = await courseCertificates(instructor, courseId);
    expect(listed).toMatchObject({ status: 'valid', canRestore: false });
    certificateId = listed!.certificateId;
    const revoked = await instructor.instructor.certificate.revoke.mutate({
      courseId,
      certificateId,
      reason: 'issued-in-error',
    });
    expect(revoked).toMatchObject({ status: 'revoked', canRestore: true });
  });

  await test.step('signed out, the verification page says it is revoked and names no one', async () => {
    await visitor.goto(`${PORTALS.student}/certificates/${certificateId}`);
    await expect(
      visitor.getByRole('heading', { name: 'Certificate revoked' }),
    ).toBeVisible();
    await expect(visitor.getByText(certificateId)).toBeVisible();
    await expect(
      visitor.getByText(`${learner.givenName} ${learner.familyName}`),
    ).toHaveCount(0);
    await expect(visitor.getByText(title)).toHaveCount(0);
    await screenshot(visitor, 'certificate-revoked-page');
  });

  await test.step('My Learning says so, and offers no Certificate control', async () => {
    await student.goto(`${PORTALS.student}/my-learning`);
    await expectInCompleted(student, async () => {
      await expect(
        student.getByText(revokedCertificateText('Issued in error')),
      ).toBeVisible({ timeout: 2_000 });
    });
    await expect(certificateControl(student)).toHaveCount(0);
    await expect(
      student.getByRole('button', { name: 'Download PDF' }),
    ).toHaveCount(0);
    await screenshot(student, 'certificate-revoked-my-learning');
  });

  await test.step('the course home says the same', async () => {
    await student.goto(`${PORTALS.student}/learn/${courseId}/home`);
    await expect(
      student.getByText(revokedCertificateText('Issued in error')),
    ).toBeVisible();
    await expect(certificateControl(student)).toHaveCount(0);
    await screenshot(student, 'certificate-revoked-course-home');
  });

  await test.step('the PDF is refused', async () => {
    const learnerApi = await apiUserFor(learner);
    await expect(
      learnerApi.core.certificate.pdf.query({ courseId }),
    ).rejects.toThrow('This certificate has been revoked');
  });

  await test.step('the student is told', async () => {
    await student
      .getByRole('button', { name: /^Notifications, \d+ unread$/ })
      .click();
    await expect(
      student.getByText(`Your certificate for ${title} was revoked`),
    ).toBeVisible();
    await screenshot(student, 'certificate-revoked-notification');
  });

  await test.step('restoring it makes the same certificate verify again', async () => {
    const instructor = await apiUserFor(ivy);
    await instructor.instructor.certificate.restore.mutate({
      courseId,
      certificateId,
    });
    await visitor.goto(`${PORTALS.student}/certificates/${certificateId}`);
    await expect(
      visitor.getByRole('heading', {
        level: 1,
        name: `${learner.givenName} ${learner.familyName}`,
      }),
    ).toBeVisible();
    await expect(visitor.getByText(certificateId)).toBeVisible();
    await expect(visitor.getByText(title)).toBeVisible();
    await screenshot(visitor, 'certificate-restored-page');
  });
});

// The same revocation through the screens (#594): the instructor from the
// course's Certificates section, an administrator from the admin portal.

test('the instructor and an administrator revoke and restore a certificate from their portals', async ({
  browser,
}) => {
  const title = uniqueName('E2E revocation screens');
  const learner = newUser('Rae', ['student']);
  const ivy = newUser('Ivy', ['instructor']);
  const cara = newUser('Cara', ['admin']);
  const instructorPage = await browser.newPage();
  const student = await browser.newPage();
  const adminPage = await browser.newPage();
  const visitor = await (await browser.newContext()).newPage();
  let courseId = '';
  let certificateId = '';
  const learnerName = `${learner.givenName} ${learner.familyName}`;

  await test.step('a student earns a certificate', async () => {
    await instructorPage.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructorPage, ivy);
    await publishCertificateCourse(instructorPage, title);
    await completeCourse(student, title, learner);
    courseId = await certificateCourseIdOf(localSubFor(learner.username));
    const [listed] = await courseCertificates(await apiUserFor(ivy), courseId);
    certificateId = listed!.certificateId;
  });

  await test.step('the instructor revokes it from the course page', async () => {
    await instructorPage.goto(`${PORTALS.instructor}/my-courses/${courseId}`);
    const row = instructorPage.getByRole('row', {
      name: new RegExp(learnerName),
    });
    await row.getByRole('button', { name: 'Revoke' }).click();
    await instructorPage.getByLabel('Reason').selectOption('issued-in-error');
    await screenshot(instructorPage, 'certificate-revoke-dialog');
    await instructorPage
      .getByRole('button', { name: 'Revoke certificate' })
      .click();
    await expect(
      row.getByText(/^Revoked on .*: Issued in error/),
    ).toBeVisible();
    await screenshot(instructorPage, 'certificates-list-revoked');
  });

  await test.step('signed out, the verification page says it is revoked', async () => {
    await visitor.goto(`${PORTALS.student}/certificates/${certificateId}`);
    await expect(
      visitor.getByRole('heading', { name: 'Certificate revoked' }),
    ).toBeVisible();
  });

  await test.step('the instructor restores it and the page verifies with the same ID', async () => {
    const row = instructorPage.getByRole('row', {
      name: new RegExp(learnerName),
    });
    await row.getByRole('button', { name: 'Restore' }).click();
    await instructorPage
      .getByRole('button', { name: 'Restore certificate' })
      .click();
    await expect(row.getByText('Valid')).toBeVisible();
    await visitor.reload();
    await expect(visitor.getByText(certificateId)).toBeVisible();
    await expect(visitor.getByText(title)).toBeVisible();
  });

  await test.step('an administrator revokes it as refunded', async () => {
    await adminPage.goto(`${PORTALS.admin}/certificates`);
    await signIn(adminPage, cara);
    await adminPage.getByLabel('Certificate ID').fill(certificateId);
    await adminPage.getByRole('button', { name: 'Look up' }).click();
    await adminPage.getByRole('button', { name: 'Revoke' }).click();
    await adminPage.getByLabel('Reason').selectOption('refunded');
    await adminPage.getByRole('button', { name: 'Revoke certificate' }).click();
    await expect(
      adminPage.getByText(/^Revoked on .*: Order refunded/),
    ).toBeVisible();
    await screenshot(adminPage, 'admin-certificate-revoked');
  });

  await test.step('the instructor sees it was revoked by an administrator', async () => {
    await instructorPage.reload();
    const row = instructorPage.getByRole('row', {
      name: new RegExp(learnerName),
    });
    await expect(row.getByText('Revoked by an administrator')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Restore' })).toHaveCount(0);
  });

  await test.step('the administrator restores it', async () => {
    await adminPage.getByRole('button', { name: 'Restore' }).click();
    await adminPage
      .getByRole('button', { name: 'Restore certificate' })
      .click();
    await expect(
      adminPage.getByRole('button', { name: 'Revoke' }),
    ).toBeVisible();
  });
});
