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
import { lessonRow } from '../helpers/free-preview.js';
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

// After a reorder, a removal, a deletion or a toggle, an instructor's focus
// is on a control that is still there, never on <body>.
test('an instructor keeps their place in the quiz builder and the course editor', async ({
  page,
}) => {
  const course = uniqueName('E2E editor focus course');
  await page.goto(`${PORTALS.instructor}/my-courses`);
  await signIn(page, newUser('Ona', ['instructor']));
  await createCourse(page, {
    title: course,
    summary: 'A course made to check where focus goes.',
  });
  await addModule(page, 'Module one');
  await addLesson(page, 'Lesson one');
  await addLesson(page, 'Lesson two');
  await page.getByRole('button', { name: 'Quiz', exact: true }).last().click();

  const dialog = page.getByRole('dialog', { name: 'New quiz' });
  await dialog.getByLabel('Title', { exact: true }).fill('Focus quiz');
  await dialog.getByLabel('Question 1', { exact: true }).fill('First?');
  for (const n of [2, 3]) {
    await dialog.getByRole('button', { name: 'Add question' }).click();
    await dialog.getByLabel(`Question ${n}`, { exact: true }).fill(`Q${n}?`);
  }

  await test.step('reordering with the keyboard keeps focus on the handle', async () => {
    const handle = dialog.getByRole('button', { name: 'Reorder Question 1' });
    await handle.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    const moved = dialog.getByRole('button', { name: /^Reorder Question \d$/ });
    await expect(moved.nth(1)).toBeFocused();
    const announcement = page.locator('[aria-live]').filter({
      hasText: 'Question',
    });
    await expect(announcement.first()).toContainText('Question');
    await expect(announcement.first()).not.toContainText(/[0-9a-f]{8}-/);
    await screenshot(page, 'quiz reorder by keyboard');
  });

  await test.step('removing a question leaves focus on a question header', async () => {
    await dialog.getByRole('button', { name: 'Remove Question 2' }).click();
    await expect(
      dialog.getByRole('button', { name: /^Remove Question/ }).first(),
    ).toBeVisible();
    const inHeader = await page.evaluate(() => {
      const active = document.activeElement;
      return (
        active !== document.body && Boolean(active?.closest('[role="dialog"]'))
      );
    });
    expect(inHeader).toBe(true);
    await dialog.getByRole('button', { name: 'Close' }).first().click();
    const discard = page.getByRole('alertdialog');
    if (await discard.isVisible()) {
      await discard.getByRole('button', { name: 'Discard changes' }).click();
    }
  });

  await test.step('toggling free preview with Enter keeps focus on the same button', async () => {
    const row = lessonRow(page, 'Lesson two');
    const make = row.getByRole('button', { name: 'Make free preview' });
    await make.focus();
    const button = await make.elementHandle();
    await page.keyboard.press('Enter');
    await page
      .getByRole('alertdialog', { name: 'Make free preview' })
      .getByRole('button', { name: 'Make free preview' })
      .focus();
    await page.keyboard.press('Enter');
    const remove = row.getByRole('button', { name: 'Remove free preview' });
    await expect(remove).toBeFocused();
    expect(
      await remove.evaluate((element, first) => element === first, button),
    ).toBe(true);
    await page.keyboard.press('Enter');
    await expect(
      row.getByRole('button', { name: 'Make free preview' }),
    ).toBeFocused();
    await screenshot(page, 'free preview toggled by keyboard');
  });

  await test.step('deleting a lesson focuses the other lesson’s control', async () => {
    await page
      .getByRole('button', { name: 'Remove lesson Lesson one' })
      .click();
    await page
      .getByRole('alertdialog', { name: 'Delete lesson' })
      .getByRole('button', { name: 'Delete lesson' })
      .click();
    const lessonTwo = page.locator('article', { hasText: 'Lesson two' });
    await expect(lessonTwo).toBeVisible();
    await expect
      .poll(() =>
        lessonTwo.evaluate((row) => row.contains(document.activeElement)),
      )
      .toBe(true);
  });
});
