/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiUser } from '../helpers/api.js';
import {
  assignmentItem,
  chooseSubmissionFile,
  createUploadAssignmentCourse,
  submitChosenFile,
  uploadSubmissionFile,
} from '../helpers/assignment.js';
import { WORKSHEET_PDF } from '../helpers/files.js';
import {
  addModule,
  addUploadAssignment,
  createCourse,
  hideItem,
  publishCourse,
  publishItem,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import {
  enrol,
  expectCourseCompleted,
  openCourse,
  startFirstLesson,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

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

  test('a student resubmits with a replacement file', async ({ page }) => {
    const instructor = await apiUser('Ivy', ['instructor']);
    const title = uniqueName('E2E resubmit assignment course');
    await createUploadAssignmentCourse(instructor, {
      courseTitle: title,
      assignmentTitle: ASSIGNMENT,
      dueAt: '2099-01-01T00:00:00.000Z',
    });

    await openCourse(page, title);
    await enrol(page, newUser('Sam', ['student']));
    await startFirstLesson(page);
    await chooseSubmissionFile(page, ASSIGNMENT, WORKSHEET_PDF);
    const item = await submitChosenFile(page, ASSIGNMENT);
    await expect(item.getByText('Version 1')).toBeVisible();

    await item.getByRole('button', { name: 'Resubmit' }).click();
    await expect(item.getByText('worksheet.pdf')).toBeVisible();
    await chooseSubmissionFile(page, ASSIGNMENT, {
      name: 'second-draft.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('second draft'),
    });
    await item.getByRole('button', { name: 'Submit', exact: true }).click();

    await expect(item.getByText('Version 2')).toBeVisible({ timeout: 30_000 });
    await expect(item.getByText('second-draft.txt')).toBeVisible();
    await expect(item.getByText('worksheet.pdf')).toHaveCount(0);
    await expect(item.getByText('Late', { exact: true })).toHaveCount(0);
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

    // Playwright takes in-memory files up to 50 MB only, so this one is a
    // sparse file on disk (it takes no real space).
    const folder = await mkdtemp(join(tmpdir(), 'discava-e2e-'));
    const huge = join(folder, 'huge.pdf');
    const file = await open(huge, 'w');
    await file.truncate(101 * 1024 * 1024);
    await file.close();
    await chooseSubmissionFile(page, ASSIGNMENT, huge);
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

  test('a student downloads their own submission and nobody else’s', async ({
    page,
  }) => {
    const instructor = await apiUser('Ivy', ['instructor']);
    const title = uniqueName('E2E download assignment course');
    const assignment = await createUploadAssignmentCourse(instructor, {
      courseTitle: title,
      assignmentTitle: ASSIGNMENT,
    });

    await openCourse(page, title);
    await enrol(page, newUser('Sam', ['student']));
    await startFirstLesson(page);
    await chooseSubmissionFile(page, ASSIGNMENT, WORKSHEET_PDF);
    const item = await submitChosenFile(page, ASSIGNMENT);

    // The link is S3Mock's unsigned URL in local dev; the file is Sam's.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      item.getByRole('button', { name: 'Download' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('worksheet.pdf');

    // Reloading shows the same submission.
    await page.reload();
    await expect(
      assignmentItem(page, ASSIGNMENT).getByText('Version 1'),
    ).toBeVisible();

    // A second student has no submission of their own, and so no file.
    const other = await apiUser('Olga', ['student']);
    await other.core.course.enrol.mutate({ courseId: assignment.courseId });
    await expect(
      other.core.assignment.mySubmission.query(assignment),
    ).resolves.toBeNull();
    await expect(
      other.core.assignment.submissionFileUrl.query(assignment),
    ).rejects.toMatchObject({ data: { code: 'NOT_FOUND' } });
  });

  test('hiding the assignment hides the submission, and showing it brings it back', async () => {
    const instructor = await apiUser('Ivy', ['instructor']);
    const assignment = await createUploadAssignmentCourse(instructor, {
      courseTitle: uniqueName('E2E hidden assignment course'),
      assignmentTitle: ASSIGNMENT,
    });
    const student = await apiUser('Sam', ['student']);
    await student.core.course.enrol.mutate({ courseId: assignment.courseId });
    await student.core.assignment.submit.mutate(
      await uploadSubmissionFile(
        student,
        assignment,
        'essay.txt',
        Buffer.from('my essay'),
      ),
    );
    await expect(
      student.core.assignment.submissionFileUrl.query(assignment),
    ).resolves.toMatchObject({ url: expect.any(String) });

    const lesson = {
      courseId: assignment.courseId,
      moduleId: assignment.moduleId,
      lessonId: assignment.lessonId,
    };
    await instructor.instructor.lesson.hide.mutate(lesson);
    await expect(
      student.core.assignment.mySubmission.query(assignment),
    ).rejects.toMatchObject({ data: { code: 'NOT_FOUND' } });
    await expect(
      student.core.assignment.submissionFileUrl.query(assignment),
    ).rejects.toMatchObject({ data: { code: 'NOT_FOUND' } });

    await instructor.instructor.lesson.publish.mutate(lesson);
    await expect(
      student.core.assignment.mySubmission.query(assignment),
    ).resolves.toMatchObject({ version: 1, file: { fileName: 'essay.txt' } });
  });

  test('the outline marks the assignment and opens it straight to the submit form', async ({
    page,
  }) => {
    const instructor = await apiUser('Ivy', ['instructor']);
    const title = uniqueName('E2E outline assignment course');
    const dueAt = '2099-01-01T00:00:00.000Z';
    await createUploadAssignmentCourse(instructor, {
      courseTitle: title,
      assignmentTitle: ASSIGNMENT,
      dueAt,
    });

    await openCourse(page, title);
    await enrol(page, newUser('Sam', ['student']));
    await startFirstLesson(page);

    const outline = page.getByRole('navigation', { name: 'Course outline' });
    const entry = outline.getByRole('link', { name: /Assignment/ });
    await expect(entry).toContainText('Assignment');
    await expect(entry).toContainText(
      `Due ${new Date(dueAt).toLocaleString()}`,
    );

    // Opening it lands on the submit form, with no list of content.
    await entry.click();
    await expect(
      assignmentItem(page, ASSIGNMENT).getByRole('button', { name: 'Submit' }),
    ).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Lesson steps' }),
    ).toHaveCount(0);
  });

  test('a student sees the resubmission request, then the grade and feedback', async ({
    page,
  }) => {
    const instructor = await apiUser('Ivy', ['instructor']);
    const title = uniqueName('E2E graded assignment course');
    const assignment = await createUploadAssignmentCourse(instructor, {
      courseTitle: title,
      assignmentTitle: ASSIGNMENT,
    });
    const feedback = (text: string) =>
      JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      });

    await openCourse(page, title);
    await enrol(page, newUser('Sam', ['student']));
    await startFirstLesson(page);
    await chooseSubmissionFile(page, ASSIGNMENT, WORKSHEET_PDF);
    const item = await submitChosenFile(page, ASSIGNMENT);

    // The student's id is found through the instructor's list.
    const ref = {
      courseId: assignment.courseId,
      contentItemId: assignment.contentItemId,
    };
    const { rows } =
      await instructor.instructor.assignmentSubmission.list.query(ref);
    const userId = rows.find((row) => row.submittedAt)?.userId as string;
    const student = { ...ref, userId };

    await test.step('the instructor asks for a resubmission', async () => {
      const current =
        await instructor.instructor.assignmentSubmission.get.query(student);
      await instructor.instructor.assignmentSubmission.requestResubmission.mutate(
        {
          ...student,
          version: current.submission?.version ?? 1,
          reviewRevision: current.submission?.reviewRevision ?? 0,
          feedback: feedback('Cite your sources'),
        },
      );
      await page.reload();
      await expect(
        item.getByText('Your instructor asked you to resubmit'),
      ).toBeVisible();
      await expect(item.getByText('Cite your sources')).toBeVisible();
      await expect(item.getByLabel('Choose file')).toBeAttached();
      await screenshot(page, 'the resubmission request beside the open form');
    });

    await test.step('the student resubmits and the instructor returns it', async () => {
      await chooseSubmissionFile(page, ASSIGNMENT, {
        name: 'second-draft.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('second draft'),
      });
      await item.getByRole('button', { name: 'Submit', exact: true }).click();
      await expect(item.getByText('Version 2')).toBeVisible({
        timeout: 30_000,
      });
      const current =
        await instructor.instructor.assignmentSubmission.get.query(student);
      await instructor.instructor.assignmentSubmission.return.mutate({
        ...student,
        version: current.submission?.version ?? 2,
        reviewRevision: current.submission?.reviewRevision ?? 0,
        points: 7,
        feedback: feedback('Well argued'),
      });
      await page.reload();
      await expect(item.getByText('7 / 10')).toBeVisible();
      await expect(item.getByText('Well argued')).toBeVisible();
      await expect(item.getByRole('button', { name: 'Resubmit' })).toHaveCount(
        0,
      );
      await expect(item.getByLabel('Choose file')).toHaveCount(0);
      await item.getByRole('button', { name: /Earlier feedback/ }).click();
      await expect(item.getByText('Cite your sources')).toBeVisible();
      await screenshot(page, 'the returned grade and feedback');
    });
  });

  test('an instructor creates an upload assignment in the portal, and a student sees it', async ({
    browser,
  }) => {
    const course = uniqueName('E2E authored assignment course');
    const instructor = await browser.newPage();
    const student = await browser.newPage();

    await test.step('the instructor adds the assignment to a module', async () => {
      await instructor.goto(`${PORTALS.instructor}/my-courses`);
      await signIn(instructor, newUser('Ivy', ['instructor']));
      await createCourse(instructor, {
        title: course,
        summary: 'A course with an assignment, made by the end-to-end tests.',
      });
      await addModule(instructor, 'Module one');
      await addUploadAssignment(instructor, {
        title: ASSIGNMENT,
        instructions: 'Write about the lesson.',
        maxPoints: 20,
        dueAt: '2099-01-01T09:00',
        beforeSave: () => screenshot(instructor, 'the new assignment dialog'),
      });

      const row = instructor.locator('article', { hasText: ASSIGNMENT });
      await expect(row.getByText('Assignment', { exact: true })).toBeVisible();
      await expect(
        instructor.getByRole('button', { name: 'Video', exact: true }),
      ).toHaveCount(0);
      await screenshot(instructor, 'the assignment in the module outline');
    });

    await test.step('the instructor edits its points and removes the due date', async () => {
      await instructor
        .getByRole('button', { name: `Edit assignment ${ASSIGNMENT}` })
        .click();
      const dialog = instructor.getByRole('dialog', {
        name: 'Edit assignment',
      });
      await expect(dialog.getByLabel('Max points')).toHaveValue('20');
      await dialog.getByLabel('Max points').fill('30');
      await dialog.getByLabel('Due date (optional)').fill('');
      await screenshot(instructor, 'editing the assignment');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toBeHidden();

      await instructor
        .getByRole('button', { name: `Edit assignment ${ASSIGNMENT}` })
        .click();
      await expect(dialog.getByLabel('Max points')).toHaveValue('30');
      await expect(dialog.getByLabel('Due date (optional)')).toHaveValue('');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
    });

    await test.step('the instructor hides and publishes it again', async () => {
      await hideItem(instructor, 'assignment', ASSIGNMENT);
      await expect(
        instructor.getByRole('button', {
          name: `Publish assignment ${ASSIGNMENT}`,
        }),
      ).toBeVisible();
      await publishItem(instructor, 'assignment', ASSIGNMENT);
      await publishCourse(instructor);
    });

    await test.step('a student sees its instructions', async () => {
      await openCourse(student, course);
      await enrol(student, newUser('Sam', ['student']));
      await startFirstLesson(student);
      await expect(
        assignmentItem(student, ASSIGNMENT).getByText(
          'Write about the lesson.',
        ),
      ).toBeVisible();
    });
  });
});
