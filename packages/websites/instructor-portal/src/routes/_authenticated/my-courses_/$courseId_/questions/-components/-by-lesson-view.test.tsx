/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  lessonsView,
  renderQuestions,
} from '../../../../../../test/render-questions';
import { ByLessonView } from './by-lesson-view';

const AT = '2026-11-17T10:00:00.000Z';
const post = (extra: Record<string, unknown> = {}) => ({
  postId: 'r1',
  threadId: 'q1',
  kind: 'reply',
  state: 'shown',
  authorName: 'Bob K.',
  authorIsInstructor: false,
  body: 'Try the basics.',
  createdAt: AT,
  voteCount: 0,
  mine: false,
  reportCount: 0,
  ...extra,
});
const question = (extra: Record<string, unknown> = {}) =>
  post({
    postId: 'q1',
    kind: 'question',
    authorName: 'Ada L.',
    title: 'What is a basis?',
    body: 'I am lost.',
    replyCount: 1,
    ...extra,
  });

const lessonRef = {
  courseId: 'c1',
  moduleId: 'm1',
  lessonId: 'l1',
};

const render = ({
  lessons = lessonsView([{ lessonId: 'l1' }]),
  thread = { question: question(), replies: [post()] } as Record<
    string,
    unknown
  >,
  instructor = {},
  core = {},
}: {
  lessons?: unknown;
  thread?: Record<string, unknown>;
  instructor?: Record<string, (input: unknown) => unknown>;
  core?: Record<string, (input: unknown) => unknown>;
} = {}) =>
  renderQuestions(<ByLessonView courseId="c1" />, {
    instructor: { 'course.view': () => lessons, ...instructor },
    core: {
      'discussion.listQuestions': () => ({ items: [question()] }),
      'discussion.thread': () => thread,
      ...core,
    },
  });

const openThread = async (rendered: ReturnType<typeof render>) => {
  await rendered.user.selectOptions(
    await screen.findByLabelText('Lesson'),
    'l1',
  );
  await rendered.user.click(
    await screen.findByRole('button', { name: 'Open thread' }),
  );
  await screen.findByText('Try the basics.');
};

describe('ByLessonView', () => {
  it("lists the lessons with their state and then the picked lesson's questions", async () => {
    const rendered = render({
      lessons: lessonsView([
        { lessonId: 'l1' },
        { lessonId: 'l2', state: 'hidden' },
        { lessonId: 'l3', state: 'archived' },
      ]),
    });

    const picker = await screen.findByLabelText('Lesson');
    expect(
      Array.from((picker as HTMLSelectElement).options).map((o) => o.text),
    ).toEqual([
      'Choose a lesson',
      'Lesson l1',
      'Lesson l2 (hidden)',
      'Lesson l3 (archived)',
    ]);
    await rendered.user.selectOptions(picker, 'l1');

    expect(await screen.findByText('What is a basis?')).toBeVisible();
    expect(
      rendered.coreCalls.find((c) => c.path === 'discussion.listQuestions')
        ?.input,
    ).toMatchObject(lessonRef);
  });

  it('labels a prompt answer and does not mark it Answered', async () => {
    const rendered = render({
      core: {
        'discussion.listQuestions': () => ({
          items: [
            question({
              postId: 'q2',
              threadId: 'q2',
              title: 'Plain question',
              answered: true,
            }),
            question({ promptAnswer: true, answered: true }),
          ],
        }),
      },
    });
    await rendered.user.selectOptions(
      await screen.findByLabelText('Lesson'),
      'l1',
    );
    expect(
      await screen.findByText('Answer to the course prompt'),
    ).toBeVisible();
    // Only the ordinary answered question says Answered.
    expect(screen.getAllByText(/· Answered/)).toHaveLength(1);
  });

  it('focuses the reply box and says "Reply posted" after posting', async () => {
    const rendered = render({
      core: { 'discussion.reply': () => post({ authorIsInstructor: true }) },
    });
    await openThread(rendered);

    await rendered.user.type(screen.getByLabelText('Your reply'), 'Hello');
    await rendered.user.click(
      screen.getByRole('button', { name: 'Post reply' }),
    );

    expect(await screen.findByText('Reply posted')).toBeVisible();
    expect(screen.getByLabelText('Your reply')).toHaveFocus();
    expect(screen.getByLabelText('Your reply')).toHaveAccessibleDescription(
      /4,000/,
    );
  });

  it('returns focus to the Open thread button when the thread closes', async () => {
    const rendered = render();
    await openThread(rendered);

    await rendered.user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open thread' })).toHaveFocus(),
    );
  });

  it('replies with the lesson ref, and the same id after a failure', async () => {
    let fail = true;
    const rendered = render({
      core: {
        'discussion.reply': () => {
          if (fail) {
            throw new Error('Questions are closed for this lesson');
          }
          return post({ authorIsInstructor: true });
        },
      },
    });
    await openThread(rendered);

    await rendered.user.type(screen.getByLabelText('Your reply'), 'Hello');
    await rendered.user.click(
      screen.getByRole('button', { name: 'Post reply' }),
    );
    await screen.findByText(/Couldn't post your reply/);
    fail = false;
    await rendered.user.click(
      screen.getByRole('button', { name: 'Post reply' }),
    );

    await waitFor(() =>
      expect(
        rendered.coreCalls.filter((c) => c.path === 'discussion.reply'),
      ).toHaveLength(2),
    );
    const [first, second] = rendered.coreCalls
      .filter((c) => c.path === 'discussion.reply')
      .map((c) => c.input as Record<string, unknown>);
    expect(first).toMatchObject({
      ...lessonRef,
      threadId: 'q1',
      body: 'Hello',
    });
    expect(second.postId).toBe(first.postId);
  });

  it('shows the Instructor badge on an instructor reply', async () => {
    const rendered = render({
      thread: {
        question: question(),
        replies: [post({ authorIsInstructor: true })],
      },
    });
    await openThread(rendered);

    expect(screen.getByText('Instructor')).toBeVisible();
  });

  it('marks a reply as the answer, as an instructor', async () => {
    const rendered = render({
      core: { 'discussion.accept': () => question() },
    });
    await openThread(rendered);

    await rendered.user.click(
      screen.getByRole('button', { name: 'Mark as answer' }),
    );

    expect(
      rendered.coreCalls.find((c) => c.path === 'discussion.accept')?.input,
    ).toEqual({ ...lessonRef, threadId: 'q1', postId: 'r1' });
  });

  it('hides a post, and unhides a hidden one showing its text with a Hidden label', async () => {
    const rendered = render({
      thread: {
        question: question(),
        replies: [
          post(),
          post({ postId: 'r2', state: 'hidden', body: 'A hidden remark' }),
        ],
      },
      instructor: {
        'discussion.hide': () => post(),
        'discussion.unhide': () => post(),
      },
    });
    await openThread(rendered);

    expect(screen.getByText('A hidden remark')).toBeVisible();
    expect(screen.getByText('Hidden')).toBeVisible();
    await rendered.user.click(screen.getByRole('button', { name: 'Unhide' }));
    await rendered.user.click(
      screen.getAllByRole('button', { name: 'Hide' })[1],
    );

    expect(
      rendered.calls.find((c) => c.path === 'discussion.unhide')?.input,
    ).toEqual({ ...lessonRef, threadId: 'q1', postId: 'r2' });
    expect(
      rendered.calls.find((c) => c.path === 'discussion.hide')?.input,
    ).toEqual({ ...lessonRef, threadId: 'q1', postId: 'r1' });
  });

  it('deletes a post after a confirmation', async () => {
    const rendered = render({
      instructor: { 'discussion.remove': () => post() },
    });
    await openThread(rendered);

    await rendered.user.click(
      screen.getAllByRole('button', { name: 'Delete' })[1],
    );
    expect(rendered.calls.some((c) => c.path === 'discussion.remove')).toBe(
      false,
    );
    await rendered.user.click(
      screen.getByRole('button', { name: 'Delete reply' }),
    );

    expect(
      rendered.calls.find((c) => c.path === 'discussion.remove')?.input,
    ).toEqual({ ...lessonRef, threadId: 'q1', postId: 'r1' });
  });

  it('is read-only for an archived lesson but still moderates', async () => {
    const rendered = render({
      lessons: lessonsView([{ lessonId: 'l1', state: 'archived' }]),
    });
    await openThread(rendered);

    expect(screen.getByText(/This lesson is archived/)).toBeVisible();
    expect(screen.queryByLabelText('Your reply')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Mark as answer' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Hide' }).length,
    ).toBeGreaterThan(0);
  });

  it('is read-only for an archived course', async () => {
    const rendered = render({
      lessons: lessonsView([{ lessonId: 'l1' }], 'archived'),
    });
    await openThread(rendered);

    expect(screen.getByText(/This course is archived/)).toBeVisible();
    expect(screen.queryByLabelText('Your reply')).not.toBeInTheDocument();
  });
});
