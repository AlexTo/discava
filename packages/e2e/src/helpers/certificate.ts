/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PDF } from '@libpdf/core';
import { type Download, expect, type Page } from '@playwright/test';
import {
  type ApiUser,
  accessTokenForClaims,
  apiClients,
  apiUser,
  textBody,
} from './api.js';
import { createPublishedCourse } from './instructor-portal.js';
import { certificateCourseIdOf } from './notification.js';
import { PORTALS } from './portals.js';
import {
  enrol,
  expectAfterReloads,
  expectCourseCompleted,
  markItemDone,
  openCourse,
  startFirstLesson,
} from './student-portal.js';
import { type NewUser, newUser, uniqueName } from './users.js';

// Steps for the certificate scenarios (#276), for scenarios to build on.

// A certificate's control in My Learning, the "Certificate" group with View,
// Download PDF and Copy link.
export const certificateControl = (page: Page) =>
  page.getByRole('group', { name: 'Certificate' });

// Publishes a course with one reading, as the signed-in instructor `page`,
// and returns its editor's address, to come back to its settings.
export const publishCertificateCourse = async (page: Page, title: string) => {
  await createPublishedCourse(page, { title, readings: ['Only reading'] });
  return page.url();
};

// Turns "Issue a certificate on completion" on or off in the course editor at
// `courseUrl`, and waits for the switch to show the saved state.
export const setCertificates = async (
  page: Page,
  courseUrl: string,
  enabled: boolean,
) => {
  await page.goto(courseUrl);
  const toggle = page.getByRole('switch', {
    name: 'Issue a certificate on completion',
  });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-checked')) === String(enabled)) {
    return;
  }
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(enabled));
  // Saved, not just shown: it is still there after a reload.
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-checked', String(enabled));
};

// Ticks or unticks "Require passing every quiz" in the course editor at
// `courseUrl`, and waits for the checkbox to show the saved state.
export const setCertificateCriteria = async (
  page: Page,
  courseUrl: string,
  { requireQuizPass }: { requireQuizPass: boolean },
) => {
  await page.goto(courseUrl);
  const checkbox = page.getByRole('checkbox', {
    name: 'Require passing every quiz',
  });
  await expect(checkbox).toBeVisible();
  if ((await checkbox.isChecked()) !== requireQuizPass) {
    await checkbox.setChecked(requireQuizPass);
  }
  await expect(checkbox).toBeChecked({ checked: requireQuizPass });
  // Saved, not just shown: it is still there after a reload.
  await page.reload();
  await expect(checkbox).toBeChecked({ checked: requireQuizPass });
};

// Ticks "Require graded assignments to be returned with at least" with
// `percent` in the course editor at `courseUrl`, and waits for it to be saved.
export const setGradedUploadCriterion = async (
  page: Page,
  courseUrl: string,
  percent: number,
) => {
  await page.goto(courseUrl);
  const checkbox = page.getByRole('checkbox', {
    name: 'Require graded assignments to be returned with at least',
  });
  const field = page.getByRole('spinbutton', {
    name: 'Minimum assignment score, percent',
  });
  await expect(checkbox).toBeVisible();
  await field.fill(String(percent));
  await checkbox.check();
  // Saved, not just shown: it is still there after a reload.
  await page.reload();
  await expect(checkbox).toBeChecked();
  await expect(field).toHaveValue(String(percent));
};

// A student enrols in the course `title` (signing in as `user` first, when
// given) and completes its only reading, and waits for the course to say so.
export const completeCourse = async (
  page: Page,
  title: string,
  user?: NewUser,
) => {
  await openCourse(page, title);
  await enrol(page, user);
  await startFirstLesson(page);
  await markItemDone(page, 'Only reading');
  await page.getByRole('link', { name: title }).click();
  await expectCourseCompleted(page);
};

// Opens My Learning's Completed tab. The progress recalculation, then the
// certificate, land a few seconds after the last completion, and My Learning
// reads them once, so this reloads until `check` passes.
export const expectInCompleted = async (
  page: Page,
  check: () => Promise<void>,
) => {
  await page.goto(`${PORTALS.student}/my-learning`);
  await expectAfterReloads(page, async () => {
    await page.getByRole('tab', { name: /^Completed/ }).click({
      timeout: 2_000,
    });
    await check();
  });
};

// The text of a downloaded PDF, once it is known to be one.
export const downloadedPdfText = async (download: Download) => {
  const bytes = await readFile(await download.path());
  expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('%PDF');
  const pdf = await PDF.load(new Uint8Array(bytes));
  return pdf
    .extractText()
    .map((page) => page.text)
    .join('\n');
};

// The ID printed on a certificate's page or PDF, in its display form.
export const CERTIFICATE_ID =
  /[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}/;

// Revocation steps (#594). The instructor's screen arrives later, so the
// instructor revokes and restores through instructor-api, as that screen will.

// The course's certificates, newest first, as the instructor sees them.
export const courseCertificates = async (
  instructor: ApiUser,
  courseId: string,
) => (await instructor.instructor.certificate.list.query({ courseId })).items;

// The text My Learning and the course home give a learner for a revoked
// certificate, for the reason `label`.
export const revokedCertificateText = (label: string) =>
  new RegExp(
    `^Certificate revoked on \\d{1,2} [A-Z][a-z]+ \\d{4}\\. Reason: ${label}\\.$`,
  );

// A certificate whose names are as long as the admin screens must hold, for
// the phone-width checks, made through the APIs so those cases stay fast: a
// fresh instructor publishes a one-reading course whose title is 80
// characters holding a 70-character word, and a fresh student with a long
// name completes it. An administrator then revokes the certificate and
// restores it twice, with 500-character notes ending in a 70-character word,
// so its history has long entries.
export const createRevokableCertificateViaApi = async (label: string) => {
  const word = 'c'.repeat(70);
  const courseTitle = `${uniqueName(label)} ${word}`.slice(-80);
  const longWord = 'x'.repeat(70);
  const note = `${'Long note '.repeat(43)}${longWord}`.slice(-500);

  const instructor = await apiUser('Ivy', ['instructor']);
  const api = instructor.instructor;
  const { courseId } = await api.course.create.mutate({ title: courseTitle });
  const { moduleId } = await api.module.create.mutate({
    courseId,
    title: 'Module 1',
  });
  const { lessonId } = await api.lesson.create.mutate({
    courseId,
    moduleId,
    title: 'Lesson 1',
  });
  const { contentItemId } = await api.contentItem.createText.mutate({
    courseId,
    moduleId,
    lessonId,
    title: 'Only reading',
    body: textBody('Only reading'),
  });
  await api.course.publish.mutate({ courseId });

  // The student's name is the claim the certificate prints.
  const learner = newUser('Bartholomew-Maximilian', ['student']);
  const familyName = 'Featherstonehaugh-Wolfeschlegel';
  const learnerName = `${learner.givenName} ${familyName}`;
  const student = apiClients(
    await accessTokenForClaims(learner.username, {
      sub: randomUUID(),
      username: learner.username,
      email: learner.email,
      email_verified: true,
      given_name: learner.givenName,
      family_name: familyName,
      name: learnerName,
      'cognito:groups': learner.roles,
    }),
  );
  await student.core.course.enrol.mutate({ courseId });
  await student.core.contentItem.complete.mutate({
    courseId,
    moduleId,
    lessonId,
    contentItemId,
  });

  const issuedCourseId = await certificateCourseIdOf(student.sub);
  expect(issuedCourseId).toBe(courseId);
  let certificateId = '';
  await expect
    .poll(
      async () => {
        certificateId =
          (await courseCertificates(instructor, courseId))[0]?.certificateId ??
          '';
        return certificateId;
      },
      { timeout: 30_000 },
    )
    .not.toBe('');

  const admin = (await apiUser('Cara', ['admin'])).admin;
  for (let i = 0; i < 2; i++) {
    await admin.certificate.revoke.mutate({
      certificateId,
      reason: 'other',
      note,
    });
    await admin.certificate.restore.mutate({ certificateId, note });
  }
  return { certificateId, courseTitle, learnerName };
};
