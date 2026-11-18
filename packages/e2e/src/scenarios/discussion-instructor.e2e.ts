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
    await page.getByLabel('Lesson').selectOption({ label: 'Lesson one' });
    await page.getByRole('button', { name: 'Open thread' }).click();
    await expect(page.getByRole('dialog').getByText('Hidden')).toBeVisible();
    await screenshot(page, 'a hidden reply in the thread');
  });
});
