/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  certificateControl,
  expectInCompleted,
  setCertificateCriteria,
} from '../helpers/certificate.js';
import {
  addLesson,
  addModule,
  addQuiz,
  addTextItem,
  createCourse,
  publishCourse,
  setQuizAttempts,
  setQuizPassMark,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import {
  enrol,
  expectCourseCompleted,
  markItemDone,
  openCourse,
  startFirstLesson,
  takeQuiz,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// The pass-every-quiz criterion (#594): an instructor ticks it, certificates
// go only to students who passed, and whoever qualifies later (by passing, or
// because the criterion was lifted) gets theirs without doing anything.

test('an instructor requires every quiz to be passed for a certificate', async ({
  browser,
}) => {
  const title = uniqueName('E2E certificate criteria course');
  const instructor = await browser.newPage();
  const first = await browser.newPage();
  const second = await browser.newPage();
  let courseUrl = '';
  let lessonUrl = '';
  // Each student's verification page, found from their My Learning.
  const links: string[] = [];

  // Takes the text item and the quiz, answering `answer`, as a new student.
  const attempt = async (
    page: typeof first,
    answers: string[],
    user = newUser('Sam', ['student']),
  ) => {
    await openCourse(page, title);
    await enrol(page, user);
    await startFirstLesson(page);
    lessonUrl = page.url();
    await markItemDone(page, 'Only reading');
    // A quiz counts as done once it is passed or out of attempts.
    for (const answer of answers) {
      await takeQuiz(page, 'Quiz one', answer);
    }
    await page.getByRole('link', { name: title }).click();
    await expectCourseCompleted(page);
  };

  await test.step('an instructor publishes a course with a quiz and ticks the criterion', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await createCourse(instructor, {
      title,
      summary: 'A course made by the end-to-end tests.',
    });
    courseUrl = instructor.url();
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Lesson one');
    await addTextItem(instructor, {
      title: 'Only reading',
      body: 'Only reading.',
    });
    await addQuiz(instructor, {
      title: 'Quiz one',
      attempts: 1,
      question: 'What is 2 + 2?',
      options: ['3', '4'],
      correct: '4',
    });
    await publishCourse(instructor);
    await setCertificateCriteria(instructor, courseUrl, {
      requireQuizPass: true,
    });
    await screenshot(instructor, 'certificate-criteria-setting');
  });

  await test.step('a student who fails the quiz completes the course without a certificate', async () => {
    await attempt(first, ['3']);
    // The course home says what is still needed, and where.
    await expect(first.getByText('Pass every quiz: 0 of 1')).toBeVisible();
    await expect(
      first.getByText(
        'Not passed, no attempts left. Ask your instructor for another attempt.',
      ),
    ).toBeVisible();
    await screenshot(first, 'certificate-requirements-unmet');
    await first.getByRole('link', { name: 'Quiz one' }).click();
    await expect(first).toHaveURL(lessonUrl);
    await first.goto(`${PORTALS.student}/my-learning`);
    await expectInCompleted(first, async () => {
      await expect(
        first.getByRole('link', { name: `Review: ${title}` }),
      ).toBeVisible({ timeout: 2_000 });
    });
    await expect(certificateControl(first)).toHaveCount(0);
  });

  await test.step('once the quiz allows another attempt, passing it gets the certificate', async () => {
    await setQuizAttempts(instructor, 'Quiz one', 2);
    await first.goto(lessonUrl);
    await takeQuiz(first, 'Quiz one', '4');
    await first.getByRole('link', { name: title }).click();
    await expect(first.getByText('You earned a certificate')).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      first.getByRole('link', { name: 'View', exact: true }),
    ).toBeVisible();
    await screenshot(first, 'certificate-requirements-met');
    // The card caught up on its own, without a reload, once progress was recalculated.
    await screenshot(first, 'certificate-requirements-recalculated');
    await first.goto(`${PORTALS.student}/my-learning`);
    await expectInCompleted(first, async () => {
      await expect(
        certificateControl(first).getByRole('link', { name: 'View' }),
      ).toBeVisible({ timeout: 2_000 });
    });
  });

  await test.step('a second student fails, and unticking the criterion gives them a certificate', async () => {
    // The quiz now allows two attempts, so both are used.
    await attempt(second, ['3', '3']);
    await setCertificateCriteria(instructor, courseUrl, {
      requireQuizPass: false,
    });
    await second.goto(`${PORTALS.student}/my-learning`);
    await expectInCompleted(second, async () => {
      await expect(
        certificateControl(second).getByRole('link', { name: 'View' }),
      ).toBeVisible({ timeout: 2_000 });
    });
  });

  await test.step('ticking it again leaves both certificates valid', async () => {
    await setCertificateCriteria(instructor, courseUrl, {
      requireQuizPass: true,
    });
    for (const page of [first, second]) {
      await page.goto(`${PORTALS.student}/my-learning`);
      await expectInCompleted(page, async () => {
        const view = certificateControl(page).getByRole('link', {
          name: 'View',
        });
        await expect(view).toBeVisible({ timeout: 2_000 });
      });
      const href = await certificateControl(page)
        .getByRole('link', { name: 'View' })
        .getAttribute('href');
      links.push(`${PORTALS.student}${href}`);
      await page.goto(links.at(-1)!);
      await expect(page.getByText('Certificate not found')).toHaveCount(0);
      await expect(page.getByText(title).first()).toBeVisible();
    }
  });

  await test.step('the certificates state what was assessed', async () => {
    const visitor = await browser.newPage();
    await visitor.goto(links[0]);
    await expect(
      visitor.getByRole('heading', { name: 'What this certificate confirms' }),
    ).toBeVisible();
    await expect(
      visitor.getByText('Passed 1 assessed quiz. Pass mark: 70%.'),
    ).toBeVisible();
    await expect(visitor.getByText(/^Overall score:/)).toBeVisible();
    await screenshot(visitor, 'certificate-statement-assessed');

    // Issued after the criterion was unticked.
    await visitor.goto(links[1]);
    await expect(
      visitor.getByText(
        'No graded assessment was required for this certificate.',
      ),
    ).toBeVisible();
    await expect(visitor.getByText(/Overall score/)).toHaveCount(0);
    await screenshot(visitor, 'certificate-statement-completion-only');
  });

  await test.step('changing the quiz later does not change what a certificate says', async () => {
    await setQuizPassMark(instructor, 'Quiz one', 50);
    const visitor = await browser.newPage();
    await visitor.goto(links[0]);
    await expect(
      visitor.getByText('Passed 1 assessed quiz. Pass mark: 70%.'),
    ).toBeVisible();
    await expect(visitor.getByText(/^Overall score:/)).toBeVisible();
  });
});
