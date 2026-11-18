/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { apiUser } from '../helpers/api.js';
import { createUploadAssignmentCourse } from '../helpers/assignment.js';
import { screenshot } from '../helpers/screenshots.js';
import {
  enrol,
  openCourse,
  startFirstLesson,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, uniqueName } from '../helpers/users.js';

// Questions on the lesson page (#280): a student asks a question and opens it.
test.describe('lesson questions in the student portal', () => {
  test('a student asks a question and sees it in the lesson', async ({
    page,
  }) => {
    const instructor = await apiUser('Ivy', ['instructor']);
    const title = uniqueName('E2E questions course');
    await createUploadAssignmentCourse(instructor, {
      courseTitle: title,
      assignmentTitle: 'Essay',
    });

    await openCourse(page, title);
    await enrol(page, newUser('Sam', ['student']));
    await startFirstLesson(page);

    const questions = page.getByRole('region', { name: 'Questions' });
    await expect(
      questions.getByText('No questions yet. Ask the first one.'),
    ).toBeVisible();
    await screenshot(page, 'lesson with no questions');

    await questions.getByLabel('Question title').fill('What is due?');
    await questions.getByLabel('Details').fill('Is the essay due Friday?');
    await questions.getByRole('button', { name: 'Post question' }).click();
    await expect(questions.getByText('What is due?')).toBeVisible();
    await screenshot(page, 'lesson with one question');

    await questions.getByRole('button', { name: 'Open question' }).click();
    await expect(questions.getByText('Is the essay due Friday?')).toBeVisible();
    await screenshot(page, 'question thread');
  });
});
