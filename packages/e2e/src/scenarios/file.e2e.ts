/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFile } from 'node:fs/promises';
import { WORKSHEET_PDF } from '../helpers/files.js';
import {
  addFileItem,
  addLesson,
  addModule,
  createCourse,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import {
  downloadLessonFile,
  enrol,
  expectCourseCompleted,
  lessonItem,
  markItemDone,
  openCourse,
  startFirstLesson,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// A lesson file from upload to download (#102): the upload goes to S3Mock's
// upload bucket, saving copies it into the lesson media bucket, and the
// student downloads it through core-api's signed link, under the name it was
// uploaded with. Downloading doesn't complete it; the student marks it done.
test('an instructor attaches a file, and a student downloads it', async ({
  browser,
}) => {
  const course = uniqueName('E2E file course');
  const instructor = await browser.newPage();
  const student = await browser.newPage();

  await test.step('the instructor attaches a file', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await createCourse(instructor, {
      title: course,
      summary: 'A course with a file, made by the end-to-end tests.',
    });
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Lesson one');
    await addFileItem(instructor, {
      title: 'Worksheet one',
      file: WORKSHEET_PDF,
    });
    await publishCourse(instructor);
  });

  await test.step('a new student enrols and downloads it', async () => {
    await openCourse(student, course);
    await enrol(student, newUser('Sam', ['student']));
    await startFirstLesson(student);
    await expect(lessonItem(student, 'Worksheet one')).toContainText(
      'worksheet.pdf',
    );
    const download = await downloadLessonFile(student, 'Worksheet one');
    expect(download.suggestedFilename()).toBe('worksheet.pdf');
    expect(await readFile(await download.path())).toEqual(
      await readFile(WORKSHEET_PDF),
    );
    await expect(
      lessonItem(student, 'Worksheet one').getByRole('button', {
        name: 'Mark as done',
      }),
    ).toBeVisible();
    await markItemDone(student, 'Worksheet one');
  });

  await test.step('the course shows as completed', async () => {
    await student.getByRole('link', { name: course }).click();
    await expectCourseCompleted(student);
  });
});
