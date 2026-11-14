/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { apiUser } from '../helpers/api.js';
import {
  assignmentItem,
  chooseSubmissionFile,
  createUploadAssignmentCourse,
  submitChosenFile,
} from '../helpers/assignment.js';
import { WORKSHEET_PDF } from '../helpers/files.js';
import {
  enrol,
  expectCourseCompleted,
  openCourse,
  startFirstLesson,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, uniqueName } from '../helpers/users.js';

// Submitting to an upload assignment (#102): the file goes to S3Mock's upload
// bucket through the presigned PUT, core-api copies it into a folder of its
// own and records the submission, the late flag and the completion in one
// transaction. The table-invariants fixture then checks what it left.
test.describe('submitting to an upload assignment', () => {
  const ASSIGNMENT = 'Essay';

  test('a student submits one file and the assignment is done', async ({
    page,
  }) => {
    const instructor = await apiUser('Ivy', ['instructor']);
    const title = uniqueName('E2E assignment course');
    await createUploadAssignmentCourse(instructor, {
      courseTitle: title,
      assignmentTitle: ASSIGNMENT,
    });

    await openCourse(page, title);
    await enrol(page, newUser('Sam', ['student']));
    await startFirstLesson(page);

    const item = assignmentItem(page, ASSIGNMENT);
    await expect(item.getByText('Write about the lesson.')).toBeVisible();
    await expect(item.getByRole('button', { name: 'Submit' })).toBeDisabled();

    await chooseSubmissionFile(page, ASSIGNMENT, WORKSHEET_PDF);
    await expect(item.getByText(/worksheet\.pdf \(/)).toBeVisible();
    await submitChosenFile(page, ASSIGNMENT);

    await expect(item.getByText('Version 1')).toBeVisible();
    await expect(item.getByText('Late', { exact: true })).toHaveCount(0);

    // The submission completed the item, so the course does too.
    await page.getByRole('link', { name: title }).click();
    await expectCourseCompleted(page);
  });

  test('work submitted after the due date is marked late', async ({ page }) => {
    const instructor = await apiUser('Ivy', ['instructor']);
    const title = uniqueName('E2E late assignment course');
    await createUploadAssignmentCourse(instructor, {
      courseTitle: title,
      assignmentTitle: ASSIGNMENT,
      dueAt: '2020-01-01T00:00:00.000Z',
    });

    await openCourse(page, title);
    await enrol(page, newUser('Sam', ['student']));
    await startFirstLesson(page);

    const item = assignmentItem(page, ASSIGNMENT);
    await expect(
      item.getByText(
        'This assignment is past due. Late work is accepted and marked late.',
      ),
    ).toBeVisible();
    await chooseSubmissionFile(page, ASSIGNMENT, WORKSHEET_PDF);
    await submitChosenFile(page, ASSIGNMENT);

    await expect(item.getByText('Late', { exact: true })).toBeVisible();
  });

  test('refuses a file that is too big or of a type that isn’t allowed', async ({
    page,
  }) => {
    const instructor = await apiUser('Ivy', ['instructor']);
    const title = uniqueName('E2E refusal assignment course');
    await createUploadAssignmentCourse(instructor, {
      courseTitle: title,
      assignmentTitle: ASSIGNMENT,
    });

    await openCourse(page, title);
    await enrol(page, newUser('Sam', ['student']));
    await startFirstLesson(page);
    const item = assignmentItem(page, ASSIGNMENT);

    await chooseSubmissionFile(page, ASSIGNMENT, {
      name: 'huge.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(101 * 1024 * 1024),
    });
    await expect(item.getByText('huge.pdf is over 100 MB')).toBeVisible();
    await expect(item.getByRole('button', { name: 'Submit' })).toBeDisabled();

    await chooseSubmissionFile(page, ASSIGNMENT, {
      name: 'run.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('MZ'),
    });
    await expect(
      item.getByText("run.exe can't be attached (type)"),
    ).toBeVisible();
    await expect(item.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  test('a user who isn’t enrolled is refused', async () => {
    const instructor = await apiUser('Ivy', ['instructor']);
    const assignment = await createUploadAssignmentCourse(instructor, {
      courseTitle: uniqueName('E2E private assignment course'),
      assignmentTitle: ASSIGNMENT,
    });
    const outsider = await apiUser('Olga', ['student']);

    await expect(
      outsider.core.assignment.uploadUrl.mutate({
        ...assignment,
        fileName: 'essay.pdf',
        fileSize: 100,
      }),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    await expect(
      outsider.core.assignment.submit.mutate({
        ...assignment,
        fileName: 'essay.pdf',
        objectKey: 'courses/not/theirs.pdf',
      }),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
  });
});
