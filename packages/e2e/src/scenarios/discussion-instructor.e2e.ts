/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { apiUser } from '../helpers/api.js';
import { newPostId } from '../helpers/discussion.js';
import {
  addLesson,
  addModule,
  addTextItem,
  createCourse,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { enrolAndLand, openCourse } from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// The instructor portal's Questions area (#280): the unanswered queue, a reply
// from the instructor, and the reported queue.
test.describe('lesson questions in the instructor portal', () => {
  test('an instructor answers a question and moderates a reported reply', async ({
    page,
  }) => {
    const course = uniqueName('E2E questions staff');

    await page.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(page, newUser('Ivy', ['instructor']));
    await createCourse(page, {
      title: course,
      summary: 'A course whose questions the end-to-end tests answer.',
    });
    await addModule(page, 'Module one');
    await addLesson(page, 'Lesson one');
    await addTextItem(page, { title: 'Reading', body: 'Text.' });
    await publishCourse(page);
    const courseId = page.url().split('/').pop()!;

    await page.getByRole('link', { name: 'Questions', exact: true }).click();
    await expect(page.getByText('All questions are answered.')).toBeVisible();
    await screenshot(page, 'unanswered with nothing to answer');

    const asker = await apiUser('Sam', ['student']);
    const other = await apiUser('Kim', ['student']);
    await asker.core.course.enrol.mutate({ courseId });
    await other.core.course.enrol.mutate({ courseId });
    const { modules } = await asker.core.course.view.query({ courseId });
    const lesson = {
      courseId,
      moduleId: modules[0].moduleId,
      lessonId: modules[0].lessons[0].lessonId,
    };
    const question = await asker.core.discussion.ask.mutate({
      ...lesson,
      postId: newPostId(),
      title: 'Where is the reading?',
      body: 'I cannot find the text.',
    });
    const reply = await other.core.discussion.reply.mutate({
      ...lesson,
      threadId: question.postId,
      postId: newPostId(),
      body: 'Buy my course.',
    });
    await asker.core.discussion.report.mutate({
      ...lesson,
      threadId: question.postId,
      postId: reply.postId,
    });

    await page.reload();
    await expect(page.getByText('Where is the reading?')).toBeVisible();
    await screenshot(page, 'unanswered with a question');

    await page.getByRole('button', { name: /^Open question/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Buy my course.')).toBeVisible();
    await dialog.getByLabel('Your reply').fill('It is under Lesson one.');
    await dialog.getByRole('button', { name: 'Post reply' }).click();
    await expect(dialog.getByText('Instructor', { exact: true })).toBeVisible();
    await screenshot(page, 'the thread with the instructor reply');
    await page.keyboard.press('Escape');

    await page.reload();
    await expect(page.getByText('All questions are answered.')).toBeVisible();

    await page.getByRole('tab', { name: 'Reported' }).click();
    await expect(page.getByText('Buy my course.')).toBeVisible();
    await expect(page.getByText(/1 report/)).toBeVisible();
    await screenshot(page, 'the reported queue');

    await page.getByRole('button', { name: 'Hide', exact: true }).click();
    await page.getByRole('tab', { name: 'By lesson' }).click();
    await page
      .getByLabel('Lesson', { exact: true })
      .selectOption({ label: 'Lesson one' });
    await page.getByRole('button', { name: 'Open thread' }).click();
    await expect(
      page.getByRole('dialog').getByText('Hidden', { exact: true }),
    ).toBeVisible();
    await screenshot(page, 'a hidden reply in the thread');
  });

  test('a prompt answer is listed by lesson, not as unanswered', async ({
    page,
  }) => {
    const course = uniqueName('E2E prompt answers');
    await page.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(page, newUser('Ivy', ['instructor']));
    await createCourse(page, {
      title: course,
      summary:
        'A course whose first-lesson prompt the end-to-end tests answer.',
    });
    await addModule(page, 'Module one');
    await addLesson(page, 'Lesson one');
    await addTextItem(page, { title: 'Reading', body: 'Text.' });
    await publishCourse(page);
    const courseId = page.url().split('/').pop()!;

    const student = await apiUser('Sam', ['student']);
    await student.core.course.enrol.mutate({ courseId });
    const { modules } = await student.core.course.view.query({ courseId });
    await student.core.discussion.answerPrompt.mutate({
      courseId,
      moduleId: modules[0].moduleId,
      lessonId: modules[0].lessons[0].lessonId,
      postId: newPostId(),
      body: 'I want to teach others.',
    });

    await page.getByRole('link', { name: 'Questions', exact: true }).click();
    await expect(page.getByText('All questions are answered.')).toBeVisible();
    await expect(page.getByText('I want to teach others.')).toBeHidden();

    await page.getByRole('tab', { name: 'By lesson' }).click();
    await page
      .getByLabel('Lesson', { exact: true })
      .selectOption({ label: 'Lesson one' });
    await expect(
      page.getByText('I want to teach others.').first(),
    ).toBeVisible();
    await expect(
      page.getByText('Answer to the course prompt').first(),
    ).toBeVisible();
    await screenshot(page, 'prompt-answer-by-lesson');
  });

  test("an instructor's prompt reaches a new learner", async ({
    page,
    browser,
  }) => {
    const course = uniqueName('E2E custom prompt');
    const custom = `Which part of ${course} will you try first?`;
    const defaultPrompt =
      /What do you want to be able to do with what this course teaches/;

    await page.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(page, newUser('Ivy', ['instructor']));
    await createCourse(page, {
      title: course,
      summary: 'A course whose first-lesson prompt the instructor words.',
    });
    await addModule(page, 'Module one');
    await addLesson(page, 'Lesson one');
    await addTextItem(page, { title: 'Reading', body: 'Text.' });
    await publishCourse(page);

    await expect(page.getByText('Using the default prompt.')).toBeVisible();
    await page.getByLabel('Prompt', { exact: true }).fill(custom);
    const savePrompt = page.getByRole('button', { name: 'Save prompt' });
    await savePrompt.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('status').filter({ hasText: 'Saved' }),
    ).toBeVisible();
    await expect(savePrompt).toBeFocused();
    await expect(page.getByText('Using the default prompt.')).toBeHidden();
    await screenshot(page, 'first-lesson-prompt-save-keeps-focus');
    await screenshot(page, 'first-lesson-prompt-form');

    // A fresh learner is asked the instructor's words.
    const firstContext = await browser.newContext();
    const first = await firstContext.newPage();
    await openCourse(first, course);
    await enrolAndLand(first, newUser('Sam', ['student']));
    const firstQuestions = first.getByRole('region', { name: 'Questions' });
    await expect(firstQuestions.getByText(custom)).toBeVisible();
    await expect(firstQuestions.getByText(defaultPrompt)).toBeHidden();
    await screenshot(first, 'first-lesson-prompt-custom');
    await firstContext.close();

    // Back to the default: the next fresh learner is asked that instead.
    await page.getByRole('button', { name: 'Use default' }).click();
    await expect(page.getByText('Using the default prompt.')).toBeVisible();
    await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('');

    const secondContext = await browser.newContext();
    const second = await secondContext.newPage();
    await openCourse(second, course);
    await enrolAndLand(second, newUser('Kim', ['student']));
    const secondQuestions = second.getByRole('region', { name: 'Questions' });
    await expect(secondQuestions.getByText(defaultPrompt)).toBeVisible();
    await expect(secondQuestions.getByText(custom)).toBeHidden();
    await secondContext.close();
  });
});
