/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addLesson,
  addModule,
  addVideoItem,
  createCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';
import { THREE_SECOND_VIDEO } from '../helpers/video.js';
import {
  addEndQuestion,
  addQuestionHere,
  openVideoQuestions,
  saveVideoQuestions,
  seekTo,
} from '../helpers/video-questions.js';

// Questions on a video's timeline: an instructor adds one at a moment of the
// video and one for the end, saves, and finds both after a reload.
test('an instructor adds questions to a video', async ({ browser }) => {
  const instructor = await browser.newPage();

  await instructor.goto(`${PORTALS.instructor}/my-courses`);
  await signIn(instructor, newUser('Ivy', ['instructor']));
  await createCourse(instructor, {
    title: uniqueName('E2E video questions course'),
    summary: 'A course with video questions, made by the end-to-end tests.',
  });
  await addModule(instructor, 'Module one');
  await addLesson(instructor, 'Lesson one');
  await addVideoItem(instructor, {
    title: 'Video one',
    file: THREE_SECOND_VIDEO,
  });

  await test.step('the instructor adds a question at 0:01 and an end question', async () => {
    const dialog = await openVideoQuestions(instructor, 'Video one');
    await seekTo(dialog, 1);
    await addQuestionHere(dialog, 1, {
      question: 'What is on screen?',
      options: ['Colour bars', 'A cat'],
      correct: 'Colour bars',
    });
    await expect(
      dialog.getByRole('textbox', { name: 'Ask at, question 1' }),
    ).toHaveValue('0:01');
    await addEndQuestion(dialog, 2, {
      question: 'Did you enjoy it?',
      options: ['Yes', 'No'],
      correct: 'Yes',
    });
    await screenshot(instructor, 'video questions editor');
    await saveVideoQuestions(dialog);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step('after a reload both are there, and the row counts them', async () => {
    await instructor.reload();
    const row = instructor.getByRole('button', {
      name: 'Questions for Video one',
    });
    await expect(row).toHaveText('Questions (2)');
    await screenshot(instructor, 'video row with question count');

    const dialog = await openVideoQuestions(instructor, 'Video one');
    await expect(
      dialog.getByRole('textbox', { name: 'Ask at, question 1' }),
    ).toHaveValue('0:01');
    await expect(
      dialog.getByRole('switch', { name: 'At the end, question 2' }),
    ).toBeChecked();
    await dialog.getByRole('button', { name: 'Expand Question 1' }).click();
    // The prompt is a rich text editor, not an input: read its text.
    await expect(
      dialog.getByLabel('Question 1', { exact: true }),
    ).toContainText('What is on screen?');
  });
});
