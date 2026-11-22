/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { apiUser, createPublishedQuizCourseViaApi } from '../helpers/api.js';
import {
  addLesson,
  addModule,
  addQuiz,
  createCourse,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import {
  enrol,
  expectCourseCompleted,
  lessonItem,
  openCourse,
  startFirstLesson,
  takeQuiz,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// A quiz graded by core-api: a failed attempt can be retaken within the
// limit, and a passing one completes the quiz by itself (no "Mark as done").
test('a student fails a quiz, retakes it and passes', async ({ browser }) => {
  const course = uniqueName('E2E quiz course');
  const instructor = await browser.newPage();
  const student = await browser.newPage();

  await test.step('the instructor adds a quiz with two attempts', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await createCourse(instructor, {
      title: course,
      summary: 'A quiz course made by the end-to-end tests.',
    });
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Lesson one');
    await addQuiz(instructor, {
      title: 'Quiz one',
      attempts: 2,
      settingsScreenshot: 'new quiz reveal setting',
      question: 'What is 2 + 2?',
      options: ['3', '4'],
      correct: '4',
    });
    await publishCourse(instructor);
  });

  await test.step('a new student enrols and fails the first attempt', async () => {
    await openCourse(student, course);
    await enrol(student, newUser('Sam', ['student']));
    await startFirstLesson(student);
    const quiz = await takeQuiz(student, 'Quiz one', '3');
    await expect(quiz.getByText('This attempt: 0% · Not passed')).toBeVisible();
  });

  await test.step('they retake it and pass, which completes it', async () => {
    const quiz = await takeQuiz(student, 'Quiz one', '4');
    await expect(quiz.getByText('This attempt: 100% · Passed')).toBeVisible();
    // The quiz is the lesson's only item, so passing it completes the lesson.
    await expect(student.getByText('1/1 lessons complete')).toBeVisible();
  });

  await test.step('the course shows as completed', async () => {
    await student.getByRole('link', { name: course }).click();
    await expectCourseCompleted(student);
  });
});

// Focus follows the quiz's phases, so a keyboard or screen reader user is
// never left on a button that was removed.
test('a student takes a quiz with the keyboard', async ({ page }) => {
  const course = uniqueName('E2E keyboard quiz course');
  await createPublishedQuizCourseViaApi(
    await apiUser('Ivy', ['instructor']),
    course,
  );
  await openCourse(page, course);
  await enrol(page, newUser('Kay', ['student']));
  await startFirstLesson(page);

  const quiz = lessonItem(page, 'Keyboard quiz');
  const focusIsInQuiz = () =>
    page.evaluate(() => {
      const active = document.activeElement;
      return active !== document.body && Boolean(active?.closest('article'));
    });

  await quiz.getByRole('button', { name: 'Start quiz' }).focus();
  await page.keyboard.press('Enter');
  await expect(quiz.getByText('Question 1 of 3')).toBeFocused();
  expect(await focusIsInQuiz()).toBe(true);

  const navigator = quiz.getByRole('navigation', { name: 'Questions' });
  for (const name of ['Question 1', 'Question 2', 'Question 3']) {
    const box = await navigator.getByRole('button', { name }).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(24);
    expect(box?.height).toBeGreaterThanOrEqual(24);
  }
  await screenshot(page, 'quiz question with numbered navigator');

  for (let i = 0; i < 3; i++) {
    await quiz.getByRole('radio', { name: 'Right' }).check();
    await quiz
      .getByRole('button', { name: i < 2 ? 'Next' : 'Review answers' })
      .click();
  }
  await expect(quiz.getByText(/3 of 3 questions answered/)).toBeFocused();
  expect(await focusIsInQuiz()).toBe(true);
  await expect(quiz.getByText('This uses attempt 1 of 2.')).toBeVisible();
  await screenshot(page, 'quiz review with attempt line');

  await quiz.getByRole('button', { name: 'Submit answers' }).click();
  await expect(quiz.getByText(/This attempt: 100%/)).toBeFocused();
  expect(await focusIsInQuiz()).toBe(true);

  await quiz.getByRole('button', { name: 'Done' }).click();
  await expect(quiz.getByText(/3 questions · Pass 50%/)).toBeFocused();
  expect(await focusIsInQuiz()).toBe(true);
});
