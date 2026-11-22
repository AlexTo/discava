/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFile } from 'node:fs/promises';
import { PDF } from '@libpdf/core';
import { type Download, expect, type Page } from '@playwright/test';
import { type ApiUser } from './api.js';
import { createPublishedCourse } from './instructor-portal.js';
import { PORTALS } from './portals.js';
import {
  enrol,
  expectAfterReloads,
  expectCourseCompleted,
  markItemDone,
  openCourse,
  startFirstLesson,
} from './student-portal.js';
import type { NewUser } from './users.js';

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
