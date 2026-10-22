/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, test } from '@playwright/test';
import {
  addLesson,
  addModule,
  addQuiz,
  createCourse,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import {
  enrol,
  expectCourseCompleted,
  openCourse,
  startFirstLesson,
  takeQuiz,
} from '../helpers/student-portal.js';
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
