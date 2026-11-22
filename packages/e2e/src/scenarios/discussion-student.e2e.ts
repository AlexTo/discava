/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { apiUser } from '../helpers/api.js';
import { createUploadAssignmentCourse } from '../helpers/assignment.js';
import {
  answerFirstLessonPrompt,
  createTwoLessonCourse,
} from '../helpers/discussion.js';
import { screenshot } from '../helpers/screenshots.js';
import {
  enrol,
  enrolAndLand,
  openCourse,
  startFirstLesson,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

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

  test('a new learner answers the first-lesson prompt once', async ({
    page,
    browser,
  }) => {
    const title = uniqueName('E2E first-lesson prompt');
    const { courseId, lessonIds } = await createTwoLessonCourse(title);
    const prompt =
      /What do you want to be able to do with what this course teaches/;
    const answer = 'I want to build my own tools.';

    await openCourse(page, title);
    const sam = newUser('Sam', ['student']);
    await enrolAndLand(page, sam);
    await expect(page).toHaveURL(new RegExp(`/lesson/${lessonIds[0]}$`));
    const lessonUrl = page.url();
    const questions = page.getByRole('region', { name: 'Questions' });
    await expect(questions.getByText(prompt)).toBeVisible();
    await screenshot(page, 'first-lesson-prompt');

    await answerFirstLessonPrompt(page, answer);
    await expect(questions.getByText(answer).first()).toBeVisible();
    await expect(
      questions.getByText('Answer to the course prompt'),
    ).toBeVisible();
    await expect(questions.getByText(prompt)).toBeHidden();
    await screenshot(page, 'first-lesson-prompt-answered');

    await page.goto(
      `${new URL(lessonUrl).origin}/learn/${courseId}/lesson/${lessonIds[1]}`,
    );
    await expect(page.getByRole('region', { name: 'Questions' })).toBeVisible();
    await expect(page.getByText(prompt)).toBeHidden();

    // The same learner on another device is not asked again.
    const secondContext = await browser.newContext();
    const second = await secondContext.newPage();
    await second.goto(lessonUrl);
    await signIn(second, sam);
    const secondQuestions = second.getByRole('region', { name: 'Questions' });
    await expect(secondQuestions.getByText(answer).first()).toBeVisible();
    await expect(secondQuestions.getByText(prompt)).toBeHidden();
    await screenshot(second, 'first-lesson-prompt-stays-closed');
    await secondContext.close();

    // Another new learner presses Not now and is not asked again either.
    const otherContext = await browser.newContext();
    const other = await otherContext.newPage();
    await openCourse(other, title);
    await enrolAndLand(other, newUser('Kim', ['student']));
    const otherQuestions = other.getByRole('region', { name: 'Questions' });
    await expect(otherQuestions.getByText(prompt)).toBeVisible();
    await otherQuestions.getByRole('button', { name: 'Not now' }).click();
    await expect(otherQuestions.getByText(prompt)).toBeHidden();
    await other.reload();
    await expect(otherQuestions.getByText(answer).first()).toBeVisible();
    await expect(otherQuestions.getByText(prompt)).toBeHidden();
    await otherContext.close();
  });
});
