/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { completeCourse } from '../helpers/certificate.js';
import {
  addLesson,
  addModule,
  addQuiz,
  createCourse,
  createPublishedCourse,
  hideItem,
  publishCourse,
  publishItem,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import {
  enrol,
  expectAfterReloads,
  openCourse,
  startFirstLesson,
  takeQuiz,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// The instructor dashboard (#278): each course's card shows the enrolments,
// active learners and completion rate counted from the records. The figures
// trail the records by the stream router's batching and a queue hop, so the
// card is read again until they show (up to 30 seconds). Afterwards the
// table-invariants fixture waits for `analytics-matches-records` (the
// aggregates equal the sums over the records).

test('an instructor sees how their course is doing, and no one else can open its analytics', async ({
  browser,
}) => {
  const title = uniqueName('E2E analytics course');
  const instructor = await browser.newPage();
  const learner = await browser.newPage();
  const other = await browser.newPage();
  let courseId = '';

  await test.step('a new instructor sees an invitation to create a course', async () => {
    await instructor.goto(`${PORTALS.instructor}/dashboard`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await expect(
      instructor.getByRole('heading', { level: 1, name: 'Dashboard' }),
    ).toBeVisible();
    await expect(
      instructor.getByText("You don't teach any courses yet"),
    ).toBeVisible();
    await expect(instructor.getByText(/illustrative placeholders/)).toHaveCount(
      0,
    );
    await screenshot(instructor, 'dashboard with no courses');
  });

  await test.step('a course nobody has joined shows zeros and no completion rate', async () => {
    await createPublishedCourse(instructor, {
      title,
      readings: ['Only reading'],
    });
    courseId = instructor.url().split('/').pop() ?? '';
    await instructor.goto(`${PORTALS.instructor}/dashboard`);
    const card = instructor.getByRole('link', { name: new RegExp(title) });
    await expect(card).toBeVisible();
    await expect(card.getByText('No data')).toBeVisible();
    await expect(
      card.getByText('Enrolments').locator('xpath=..'),
    ).toContainText('0');
    await screenshot(instructor, 'course card before anyone enrols');
  });

  await test.step('a student enrols and completes the reading', async () => {
    await completeCourse(learner, title, newUser('Sam', ['student']));
  });

  await test.step('the card shows 1 enrolment and 1 active this week within 30 seconds', async () => {
    await expectAfterReloads(instructor, async () => {
      const card = instructor.getByRole('link', { name: new RegExp(title) });
      await expect(
        card.getByText('Enrolments').locator('xpath=..'),
      ).toContainText('1', { timeout: 2_000 });
      await expect(
        card.getByText('Active this week').locator('xpath=..'),
      ).toContainText('1', { timeout: 2_000 });
      await expect(
        card.getByText('Completion rate').locator('xpath=..'),
      ).toContainText('100%', { timeout: 2_000 });
    });
    await expect(
      instructor
        .getByRole('link', { name: new RegExp(title) })
        .getByText(/^Last updated /),
    ).toBeVisible();
    await screenshot(instructor, 'course card with an enrolment and activity');
  });

  await test.step('the course analytics page shows today’s bars and the totals', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await instructor.goto(`${PORTALS.instructor}/dashboard/${courseId}`);
    await expectAfterReloads(instructor, async () => {
      const enrolments = instructor.getByRole('table', {
        name: 'New enrolments per day',
      });
      await expect(
        enrolments.getByRole('row', { name: new RegExp(today) }),
      ).toContainText('1', { timeout: 2_000 });
      const active = instructor.getByRole('table', {
        name: 'Active learners per day',
      });
      await expect(
        active.getByRole('row', { name: new RegExp(today) }),
      ).toContainText('1', { timeout: 2_000 });
    });
    await expect(
      instructor.getByRole('heading', { level: 1, name: title }),
    ).toBeVisible();
    await expect(
      instructor
        .getByLabel('Totals')
        .getByText('Completed')
        .locator('xpath=..'),
    ).toContainText('1');
    await expect(
      instructor
        .getByRole('table', { name: 'New enrolments per day' })
        .getByRole('row'),
    ).toHaveCount(91);
    await screenshot(instructor, 'course analytics over 90 days');

    await instructor.getByRole('button', { name: '30 days' }).click();
    await expect(instructor).toHaveURL(/days=30/);
    await expect(
      instructor
        .getByRole('table', { name: 'New enrolments per day' })
        .getByRole('row'),
    ).toHaveCount(31);
    await screenshot(instructor, 'course analytics over 30 days');
  });

  await test.step('the lesson drop-off lists the lesson, drops it while hidden and brings it back', async () => {
    const lessons = instructor.getByRole('list', {
      name: 'Lessons in course order',
    });
    await expectAfterReloads(instructor, async () => {
      await expect(
        lessons.getByRole('listitem').filter({ hasText: 'Lesson one' }),
      ).toContainText('100%', { timeout: 2_000 });
    });
    await expect(
      lessons.getByRole('listitem').filter({ hasText: 'Lesson one' }),
    ).toContainText('1 started, 1 completed');
    await screenshot(instructor, 'lesson drop-off with a completed lesson');

    await instructor.goto(`${PORTALS.instructor}/my-courses/${courseId}`);
    await hideItem(instructor, 'lesson', 'Lesson one');
    await instructor.goto(`${PORTALS.instructor}/dashboard/${courseId}`);
    await expect(
      instructor.getByText('No lessons are shown to learners yet.'),
    ).toBeVisible();
    await expect(lessons).toHaveCount(0);
    await screenshot(instructor, 'lesson drop-off with the lesson hidden');

    await instructor.goto(`${PORTALS.instructor}/my-courses/${courseId}`);
    await publishItem(instructor, 'lesson', 'Lesson one');
    await instructor.goto(`${PORTALS.instructor}/dashboard/${courseId}`);
    await expect(
      lessons.getByRole('listitem').filter({ hasText: 'Lesson one' }),
    ).toContainText('1 started, 1 completed');
    await screenshot(instructor, 'lesson drop-off with the lesson shown again');
  });

  await test.step('a second instructor does not see the course, nor can open its analytics page', async () => {
    await other.goto(`${PORTALS.instructor}/dashboard`);
    await signIn(other, newUser('Omar', ['instructor']));
    await expect(
      other.getByText("You don't teach any courses yet"),
    ).toBeVisible();
    await expect(other.getByText(title)).toHaveCount(0);

    await other.goto(`${PORTALS.instructor}/dashboard/${courseId}`);
    await expect(other.getByText(title)).toHaveCount(0);
    await expect(other.getByText('Enrolments')).toHaveCount(0);
    await screenshot(other, 'analytics page of a course they do not teach');
  });
});

// Quiz analysis (#278, story 4): a wrong answer shows as an attempt and a miss
// on its question, and the student's best score lands in the 0-9 band. One
// attempt is under the five a question needs to be ranked, so it says so.
test('an instructor sees which quiz question a learner missed', async ({
  browser,
}) => {
  const title = uniqueName('E2E quiz analytics course');
  const instructor = await browser.newPage();
  const learner = await browser.newPage();
  let courseId = '';

  await test.step('the instructor publishes a course with a one-question quiz', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Quinn', ['instructor']));
    await createCourse(instructor, {
      title,
      summary: 'A quiz analytics course made by the end-to-end tests.',
    });
    courseId = instructor.url().split('/').pop() ?? '';
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

  await test.step('a student enrols and answers wrongly', async () => {
    await openCourse(learner, title);
    await enrol(learner, newUser('Sam', ['student']));
    await startFirstLesson(learner);
    const quiz = await takeQuiz(learner, 'Quiz one', '3');
    await expect(quiz.getByText('This attempt: 0% · Not passed')).toBeVisible();
  });

  await test.step('the question and the score band show within 30 seconds', async () => {
    await instructor.goto(`${PORTALS.instructor}/dashboard/${courseId}`);
    await expectAfterReloads(instructor, async () => {
      await expect(
        instructor.getByRole('article', { name: 'Quiz one' }),
      ).toContainText('1 student', { timeout: 2_000 });
    });
    await screenshot(instructor, 'quiz panel closed');

    await instructor.getByRole('button', { name: 'Show analysis' }).click();
    const questions = instructor.getByRole('table', {
      name: 'Most-missed questions for Quiz one',
    });
    const row = questions.getByRole('row', { name: /What is 2 \+ 2\?/ });
    await expect(row).toContainText('Not enough attempts');
    await expect(row.getByRole('cell').nth(2)).toHaveText('1');
    await expect(row.getByRole('cell').nth(3)).toHaveText('1');

    const scores = instructor.getByRole('table', {
      name: 'Best scores for Quiz one',
    });
    await expect(scores.getByRole('row', { name: /0-9/ })).toContainText('1');
    await expect(scores.getByRole('row')).toHaveCount(11);
    await screenshot(instructor, 'quiz analysis with a missed question');
  });
});
