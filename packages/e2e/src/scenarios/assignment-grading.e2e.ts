/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFile } from 'node:fs/promises';
import { apiUser } from '../helpers/api.js';
import {
  apiUserFor,
  assignmentItem,
  chooseSubmissionFile,
  createUploadAssignmentCourse,
  editGrade,
  fillGrade,
  openLesson,
  openSubmissionReview,
  openSubmissions,
  requestResubmission,
  returnSubmission,
  submissionRowNames,
  uploadSubmissionFile,
} from '../helpers/assignment.js';
import { WORKSHEET_PDF } from '../helpers/files.js';
import { emailsFor } from '../helpers/notification.js';
import { PORTALS } from '../helpers/portals.js';
import { waitForQueuesToDrain } from '../helpers/router.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// Grading uploaded work (#102): the instructor finds the waiting work oldest
// first, previews it, asks for a resubmission, returns it with points and
// feedback and amends the grade, and the student is told each time.
test('an instructor reviews, returns and amends submitted work', async ({
  browser,
  page,
}) => {
  const ASSIGNMENT = 'Essay';
  const ivy = newUser('Ivy', ['instructor']);
  const sam = newUser('Sam', ['student']);
  const instructor = await apiUserFor(ivy);
  const samApi = await apiUserFor(sam);
  const tess = await apiUser('Tess', ['student']);
  const ref = await createUploadAssignmentCourse(instructor, {
    courseTitle: uniqueName('E2E grading course'),
    assignmentTitle: ASSIGNMENT,
    maxPoints: 20,
  });

  // Sam signs in once so their record exists, then submits a PDF; Tess, who
  // submitted a docx earlier, has waited longer.
  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await studentPage.goto(`${PORTALS.student}/my-learning`);
  await signIn(studentPage, sam);
  for (const student of [tess, samApi]) {
    await student.core.course.enrol.mutate({ courseId: ref.courseId });
  }
  await tess.core.assignment.submit.mutate(
    await uploadSubmissionFile(tess, ref, 'essay.docx', Buffer.from('docx')),
  );
  await samApi.core.assignment.submit.mutate(
    await uploadSubmissionFile(
      samApi,
      ref,
      'essay.pdf',
      await readFile(WORKSHEET_PDF),
    ),
  );

  await test.step('the list shows both waiting, oldest first', async () => {
    await page.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(page, ivy);
    await openSubmissions(page, ref, ASSIGNMENT);
    await expect(submissionRowNames(page)).toHaveText([/Tess/, /Sam/]);
    await expect(page.getByText('Waiting 2')).toBeVisible();
    await screenshot(page, 'submissions list');
  });

  await test.step('a docx offers Download, a PDF previews', async () => {
    await openSubmissionReview(page, 'Tess');
    await expect(page.getByText('essay.docx')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download' })).toBeVisible();
    await expect(page.locator('.react-pdf__Page')).toHaveCount(0);
    await page.goBack();

    await openSubmissionReview(page, 'Sam');
    await expect(page.locator('.react-pdf__Page canvas')).toBeVisible({
      timeout: 30_000,
    });
    // The canvas only: no text layer printing the page's text again.
    await expect(page.locator('.react-pdf__Page__textContent')).toHaveCount(0);
    await screenshot(page, 'pdf preview and grading form');
  });

  await test.step('a resubmission is requested', async () => {
    await requestResubmission(page, 'Please add your sources');
    await screenshot(page, 'resubmission requested');

    // The notification is delivered through a queue.
    await waitForQueuesToDrain();
    await openLesson(studentPage, ref);
    const item = assignmentItem(studentPage, ASSIGNMENT);
    await expect(
      item.getByText('Your instructor asked you to resubmit'),
    ).toBeVisible();
    await expect(item.getByText('Please add your sources')).toBeVisible();
    await expect(item.getByLabel('Choose file')).toBeAttached();
    await screenshot(studentPage, 'student sees the resubmission request');
    await studentPage
      .getByRole('button', { name: /^Notifications, \d+ unread/ })
      .click();
    await expect(
      studentPage.getByText(`Resubmission requested: "${ASSIGNMENT}"`),
    ).toBeVisible();
  });

  await test.step('the student resubmits and the work waits again at version 2', async () => {
    await studentPage.reload();
    await chooseSubmissionFile(studentPage, ASSIGNMENT, {
      name: 'essay-v2.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('second draft'),
    });
    await assignmentItem(studentPage, ASSIGNMENT)
      .getByRole('button', { name: 'Submit', exact: true })
      .click();
    await expect(
      assignmentItem(studentPage, ASSIGNMENT).getByText('Version 2'),
    ).toBeVisible({ timeout: 30_000 });

    await openSubmissions(page, ref, ASSIGNMENT);
    const row = page.getByRole('row', { name: /Sam/ });
    await expect(row).toContainText('Waiting');
    await expect(row).toContainText('2');
  });

  await test.step('returning gives the student the grade, a notification and an email', async () => {
    await openSubmissionReview(page, 'Sam');
    await fillGrade(page, 17, 'Good work');
    await screenshot(page, 'return form filled in');
    await returnSubmission(page, 17, 'Good work');

    await waitForQueuesToDrain();
    await studentPage.reload();
    const item = assignmentItem(studentPage, ASSIGNMENT);
    await expect(item.getByText(/17 \/ 20/)).toBeVisible();
    await expect(item.getByText('Good work')).toBeVisible();
    await expect(item.getByRole('button', { name: 'Resubmit' })).toHaveCount(0);
    await screenshot(studentPage, 'student sees the returned grade');
    await studentPage
      .getByRole('button', { name: /^Notifications, \d+ unread/ })
      .click();
    await expect(
      studentPage.getByText(`Your assignment "${ASSIGNMENT}" was returned`),
    ).toBeVisible();
    await expect
      .poll(async () => (await emailsFor(sam.email, 'was returned')).length)
      .toBe(1);
  });

  await test.step('Edit grade starts from the grade just returned', async () => {
    await page.getByRole('button', { name: 'Edit grade' }).click();
    await expect(page.getByLabel('Points')).toHaveValue('17');
    await screenshot(page, 'edit grade starts from the returned grade');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  await test.step('editing the grade notifies the student again', async () => {
    await editGrade(page, 18);

    await waitForQueuesToDrain();
    await studentPage.reload();
    await expect(
      assignmentItem(studentPage, ASSIGNMENT).getByText(/18 \/ 20/),
    ).toBeVisible();
    await studentPage
      .getByRole('button', { name: /^Notifications, \d+ unread/ })
      .click();
    await expect(
      studentPage.getByText(`Your grade for "${ASSIGNMENT}" was updated`),
    ).toBeVisible();
  });

  await test.step('points over the maximum are refused', async () => {
    await page.getByRole('button', { name: 'Edit grade' }).click();
    await page.getByLabel('Points').fill('25');
    await page.getByRole('button', { name: 'Save grade' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'Points must be between 0 and 20',
    );
  });

  await studentContext.close();
});
