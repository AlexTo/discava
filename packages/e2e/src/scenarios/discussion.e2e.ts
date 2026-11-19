/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { apiUser } from '../helpers/api.js';
import {
  ask,
  createDiscussionCourse,
  dropEnrolment,
  enrolledStudent,
  readThread,
  reply,
} from '../helpers/discussion.js';
import {
  addLesson,
  addModule,
  addTextItem,
  createCourse,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import {
  enrol,
  openCourse,
  startFirstLesson,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// Lesson discussions (#280) end to end: what a student sees, who is refused,
// what an instructor does, and what happens to threads when a lesson is
// archived.
test.describe('lesson discussions', () => {
  test('a student asks, a classmate replies and upvotes, and the asker accepts the answer', async ({
    page,
  }) => {
    const title = uniqueName('E2E discussion course');
    const { key } = await createDiscussionCourse(title);

    await openCourse(page, title);
    await enrol(page, newUser('Sam', ['student']));
    await startFirstLesson(page);

    const questions = page.getByRole('region', { name: 'Questions' });
    await questions.getByLabel('Question title').fill('How do I start?');
    await questions.getByLabel('Details').fill('Where does Reading 1 begin?');
    await questions.getByRole('button', { name: 'Post question' }).click();
    await expect(questions.getByText('How do I start?')).toBeVisible();

    // A classmate answers it and upvotes the question.
    const classmate = await enrolledStudent('Kim', key.courseId);
    const [{ postId: threadId }] = (
      await classmate.core.discussion.listQuestions.query(key)
    ).items;
    const answer = await reply(
      classmate,
      key,
      threadId,
      'It begins on the first line.',
    );
    await classmate.core.discussion.vote.mutate({
      ...key,
      threadId,
      postId: threadId,
      voted: true,
    });

    await page.reload();
    await questions.getByRole('button', { name: 'Open question' }).click();
    await expect(
      questions.getByText('It begins on the first line.'),
    ).toBeVisible();
    await expect(questions.getByText('1 upvote')).toBeVisible();
    await screenshot(page, 'a question with a classmate reply');

    await questions.getByRole('button', { name: 'Mark as answer' }).click();
    await expect(questions.getByText('Accepted answer')).toBeVisible();
    await expect(
      questions.getByRole('button', { name: 'Remove answer' }),
    ).toBeVisible();
    await screenshot(page, 'the accepted answer pinned');

    const read = await readThread(classmate, key, threadId);
    expect(read.accepted?.postId).toBe(answer.postId);
  });

  test('someone who is not enrolled, or who dropped, is refused', async () => {
    const { key } = await createDiscussionCourse(
      uniqueName('E2E discussion access'),
    );
    const student = await enrolledStudent('Sam', key.courseId);
    const question = await ask(student, key, 'Is this private?');

    const stranger = await apiUser('Nora', ['student']);
    await expect(
      stranger.core.discussion.listQuestions.query(key),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    await expect(
      stranger.core.discussion.thread.query({
        ...key,
        threadId: question.postId,
      }),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    await expect(ask(stranger, key, 'Let me in')).rejects.toMatchObject({
      data: { code: 'FORBIDDEN' },
    });

    const dropped = await enrolledStudent('Drew', key.courseId);
    await dropEnrolment(key.courseId, dropped);
    await expect(
      dropped.core.discussion.listQuestions.query(key),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });

    // Staff calls are for the course's instructors.
    await expect(
      student.instructor.discussion.unanswered.query({
        courseId: key.courseId,
      }),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
  });

  test('an instructor answers and moderates, and archiving a lesson keeps its thread', async ({
    page,
  }) => {
    const course = uniqueName('E2E discussion staff');
    await page.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(page, newUser('Ivy', ['instructor']));
    await createCourse(page, {
      title: course,
      summary: 'A course whose questions the end-to-end tests moderate.',
    });
    await addModule(page, 'Module one');
    await addLesson(page, 'Lesson one');
    await addTextItem(page, { title: 'Reading', body: 'Text.' });
    await publishCourse(page);
    const courseId = page.url().split('/').pop()!;

    const asker = await enrolledStudent('Sam', courseId);
    const other = await enrolledStudent('Kim', courseId);
    const { modules } = await asker.core.course.view.query({ courseId });
    const key = {
      courseId,
      moduleId: modules[0].moduleId,
      lessonId: modules[0].lessons[0].lessonId,
    };
    const question = await ask(asker, key, 'Where is the reading?');
    const spam = await reply(other, key, question.postId, 'Buy my course.');
    await asker.core.discussion.report.mutate({
      ...key,
      threadId: question.postId,
      postId: spam.postId,
    });

    // The instructor, not enrolled, replies from the Questions area, and the
    // question leaves the unanswered list.
    await page.getByRole('link', { name: 'Questions', exact: true }).click();
    await page.getByRole('button', { name: /^Open question/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Your reply').fill('It is under Lesson one.');
    await dialog.getByRole('button', { name: 'Post reply' }).click();
    await expect(dialog.getByText('Instructor', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByText('All questions are answered.')).toBeVisible();

    // The reported reply is hidden: the student sees only the placeholder.
    await page.getByRole('tab', { name: 'Reported' }).click();
    await expect(page.getByText('Buy my course.')).toBeVisible();
    await screenshot(page, 'the reported reply');
    await page.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect
      .poll(async () => {
        const { replies } = await readThread(asker, key, question.postId);
        return replies.find((r) => r.postId === spam.postId)?.state;
      })
      .toBe('hidden');
    const hidden = (await readThread(asker, key, question.postId)).replies.find(
      (r) => r.postId === spam.postId,
    );
    expect(hidden?.body).toBeUndefined();
    await screenshot(page, 'after hiding the reply');
  });

  test('a reported reply is hidden, unhidden and deleted, and an archived lesson keeps its thread', async () => {
    const { instructor, key } = await createDiscussionCourse(
      uniqueName('E2E discussion lifecycle'),
    );
    const asker = await enrolledStudent('Sam', key.courseId);
    const other = await enrolledStudent('Kim', key.courseId);
    const question = await ask(asker, key, 'Can I see this later?');
    const spam = await reply(other, key, question.postId, 'Buy my course.');
    const post = { ...key, threadId: question.postId, postId: spam.postId };
    const staff = instructor.instructor.discussion;
    const spamAs = async (user: typeof asker) =>
      (await readThread(user, key, question.postId)).replies.find(
        (r) => r.postId === spam.postId,
      );

    await asker.core.discussion.report.mutate(post);
    const queue = await staff.reported.query({ courseId: key.courseId });
    expect(queue.items.map((item) => item.postId)).toContain(spam.postId);

    await staff.hide.mutate(post);
    expect(await spamAs(asker)).toMatchObject({ state: 'hidden' });
    expect((await spamAs(asker))?.body).toBeUndefined();
    await staff.unhide.mutate(post);
    expect((await spamAs(asker))?.body).toBe('Buy my course.');
    await staff.remove.mutate(post);
    expect(await spamAs(asker)).toMatchObject({ state: 'deleted' });
    expect((await spamAs(other))?.body).toBeUndefined();
    expect((await spamAs(instructor))?.body).toBeUndefined();

    // Archiving the lesson shuts students out and keeps the thread for staff.
    await instructor.instructor.lesson.delete.mutate(key);
    await expect(
      asker.core.discussion.listQuestions.query(key),
    ).rejects.toMatchObject({ data: { code: 'NOT_FOUND' } });
    const kept = await readThread(instructor, key, question.postId);
    expect(kept.question.title).toBe('Can I see this later?');
    await expect(
      instructor.instructor.lesson.deletePermanently.mutate(key),
    ).rejects.toMatchObject({ data: { code: 'PRECONDITION_FAILED' } });

    await instructor.instructor.lesson.restore.mutate(key);
    const restored = await readThread(asker, key, question.postId);
    expect(restored.question.title).toBe('Can I see this later?');
    expect(restored.replies).toHaveLength(1);
  });

  test('a reply notifies the asker once, and accepting tells the replier', async () => {
    const { key } = await createDiscussionCourse(
      uniqueName('E2E discussion notifications'),
    );
    const asker = await enrolledStudent('Sam', key.courseId);
    const other = await enrolledStudent('Kim', key.courseId);
    const question = await ask(asker, key, 'Will I hear back?');
    await reply(asker, key, question.postId, 'Answering myself.');
    const answer = await reply(other, key, question.postId, 'Yes you will.');

    const types = async (user: typeof asker) =>
      (await user.core.notification.list.query({ limit: 50 })).items.map(
        (item) => item.type,
      );
    await expect
      .poll(async () =>
        (await types(asker)).filter((t) => t === 'discussion.reply'),
      )
      .toHaveLength(1);

    await asker.core.discussion.accept.mutate({
      ...key,
      threadId: question.postId,
      postId: answer.postId,
    });
    await expect
      .poll(async () => await types(other))
      .toContain('discussion.accepted');
  });
});
