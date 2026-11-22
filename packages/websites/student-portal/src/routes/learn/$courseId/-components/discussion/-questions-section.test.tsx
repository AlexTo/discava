/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  type Handler,
  renderWithCoreApi,
} from '../../../../../test/render-with-core-api';
import { QuestionsSection } from './questions-section';

const AT = '2026-10-05T12:00:00.000Z';

const question = (overrides: Record<string, unknown> = {}) => ({
  postId: 'q-1',
  threadId: 'q-1',
  kind: 'question',
  state: 'shown',
  authorName: 'Ada L.',
  authorIsInstructor: false,
  title: 'What is a basis?',
  body: 'I am lost.',
  createdAt: AT,
  voteCount: 3,
  replyCount: 2,
  accepted: false,
  ...overrides,
});

const render = (
  handlers: Record<string, Handler> = {},
  {
    readOnly = false,
    firstLessonPrompt,
  }: { readOnly?: boolean; firstLessonPrompt?: string } = {},
) =>
  renderWithCoreApi(
    <QuestionsSection
      courseId="course-1"
      moduleId="module-1"
      lessonId="lesson-1"
      readOnly={readOnly}
      firstLessonPrompt={firstLessonPrompt}
    />,
    {
      handlers: {
        'discussion.listQuestions': () => ({ items: [question()] }),
        ...handlers,
      },
    },
  );

const postIdOf = (call: { input: unknown }) =>
  (call.input as { postId: string }).postId;

describe('QuestionsSection', () => {
  it('shows skeleton rows while loading', async () => {
    render({ 'discussion.listQuestions': () => new Promise(() => {}) });
    expect(
      await screen.findByRole('status', { name: 'Loading questions' }),
    ).toBeInTheDocument();
  });

  it('invites the first question and offers the form when empty', async () => {
    render({ 'discussion.listQuestions': () => ({ items: [] }) });
    expect(
      await screen.findByText(/No questions yet. Ask the first one./),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Post question' }),
    ).toBeInTheDocument();
  });

  it('lists each question with its author, replies, answered mark and upvotes', async () => {
    render({
      'discussion.listQuestions': () => ({
        items: [
          question({ accepted: true, authorIsInstructor: true }),
          question({
            postId: 'q-2',
            threadId: 'q-2',
            state: 'hidden',
            title: undefined,
          }),
          question({ postId: 'q-3', threadId: 'q-3', state: 'deleted' }),
        ],
      }),
    });
    expect(await screen.findByText('What is a basis?')).toBeInTheDocument();
    expect(screen.getByText('Ada L.')).toBeInTheDocument();
    expect(screen.getByText('Instructor')).toBeInTheDocument();
    expect(screen.getByText(/^asked /)).toBeInTheDocument();
    expect(screen.getByText('2 replies')).toBeInTheDocument();
    expect(screen.getByText('Answered')).toBeInTheDocument();
    expect(screen.getByText('3 upvotes')).toBeInTheDocument();
    expect(
      screen.getByText('This post was hidden by an instructor.'),
    ).toBeInTheDocument();
    expect(screen.getByText('This post was deleted.')).toBeInTheDocument();
  });

  it('shows markup in a title as text', async () => {
    render({
      'discussion.listQuestions': () => ({
        items: [question({ title: '<img src=x onerror=alert(1)>' })],
      }),
    });
    expect(
      await screen.findByText('<img src=x onerror=alert(1)>'),
    ).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('asks for the lesson and loads more with the cursor', async () => {
    const { user, calls } = render({
      'discussion.listQuestions': (input) =>
        (input as { cursor?: string }).cursor
          ? {
              items: [
                question({ postId: 'q-2', threadId: 'q-2', title: 'Second' }),
              ],
            }
          : { items: [question()], cursor: 'next' },
    });
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Second')).toBeInTheDocument();
    expect(
      calls
        .filter((c) => c.path === 'discussion.listQuestions')
        .map((c) => c.input),
    ).toEqual([
      expect.objectContaining({
        courseId: 'course-1',
        moduleId: 'module-1',
        lessonId: 'lesson-1',
      }),
      expect.objectContaining({
        courseId: 'course-1',
        moduleId: 'module-1',
        lessonId: 'lesson-1',
        cursor: 'next',
      }),
    ]);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('shows an error with Try again that recovers', async () => {
    let fail = true;
    const { user } = render({
      'discussion.listQuestions': () => {
        if (fail) {
          throw new ApiError('INTERNAL_SERVER_ERROR', 'Boom');
        }
        return { items: [question()] };
      },
    });
    expect(
      await screen.findByText("Couldn't load the questions"),
    ).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('What is a basis?')).toBeInTheDocument();
  });

  it('is read-only for an archived course, with no form', async () => {
    render({}, { readOnly: true });
    expect(await screen.findByText('What is a basis?')).toBeInTheDocument();
    expect(
      screen.getByText('This course is archived, so questions are read-only.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post question' })).toBeNull();
    expect(screen.queryByLabelText('Question title')).toBeNull();
  });

  describe('ask form', () => {
    const fill = async (user: ReturnType<typeof render>['user']) => {
      await user.type(await screen.findByLabelText('Question title'), 'Why?');
      await user.type(screen.getByLabelText('Details'), 'Because.');
    };

    it('disables Post question until both fields are filled and counts the title', async () => {
      const { user } = render();
      const post = await screen.findByRole('button', { name: 'Post question' });
      expect(post).toBeDisabled();
      expect(screen.getByText('0 / 120')).toBeInTheDocument();
      await user.type(screen.getByLabelText('Question title'), 'Why?');
      expect(screen.getByText('4 / 120')).toBeInTheDocument();
      expect(post).toBeDisabled();
      await user.type(screen.getByLabelText('Details'), 'Because.');
      expect(post).toBeEnabled();
    });

    it('posts with a UUID v7 id, clears the form and renews the id', async () => {
      const { user, calls } = render({
        'discussion.ask': () => question(),
      });
      await fill(user);
      await user.click(screen.getByRole('button', { name: 'Post question' }));
      await waitFor(() =>
        expect(screen.getByLabelText('Question title')).toHaveValue(''),
      );
      await fill(user);
      await user.click(screen.getByRole('button', { name: 'Post question' }));
      await waitFor(() =>
        expect(calls.filter((c) => c.path === 'discussion.ask')).toHaveLength(
          2,
        ),
      );
      const asks = calls.filter((c) => c.path === 'discussion.ask');
      expect(asks[0].input).toEqual({
        courseId: 'course-1',
        moduleId: 'module-1',
        lessonId: 'lesson-1',
        postId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7/),
        title: 'Why?',
        body: 'Because.',
      });
      expect(postIdOf(asks[1])).not.toBe(postIdOf(asks[0]));
    });

    it('keeps the text and the post id after an error, and shows the message', async () => {
      let fail = true;
      const { user, calls } = render({
        'discussion.ask': () => {
          if (fail) {
            throw new ApiError(
              'PRECONDITION_FAILED',
              'Questions are closed for this lesson',
            );
          }
          return question();
        },
      });
      await fill(user);
      await user.click(screen.getByRole('button', { name: 'Post question' }));
      expect(
        await screen.findByText('Questions are closed for this lesson'),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Question title')).toHaveValue('Why?');
      expect(screen.getByLabelText('Details')).toHaveValue('Because.');

      fail = false;
      await user.click(screen.getByRole('button', { name: 'Post question' }));
      await waitFor(() =>
        expect(screen.getByLabelText('Question title')).toHaveValue(''),
      );
      const asks = calls.filter((c) => c.path === 'discussion.ask');
      expect(asks).toHaveLength(2);
      expect(postIdOf(asks[1])).toBe(postIdOf(asks[0]));
    });
  });

  describe('first-lesson prompt', () => {
    const PROMPT = 'What do you hope to learn?';
    const prompt = () => screen.queryByRole('group', { name: PROMPT });

    it('shows once the list has loaded', async () => {
      render({}, { firstLessonPrompt: PROMPT });
      expect(
        await screen.findByRole('group', { name: PROMPT }),
      ).toBeInTheDocument();
    });

    it('is absent without the prop', async () => {
      render();
      await screen.findByText('What is a basis?');
      expect(prompt()).toBeNull();
    });

    it('is absent while the list loads', async () => {
      render(
        { 'discussion.listQuestions': () => new Promise(() => {}) },
        { firstLessonPrompt: PROMPT },
      );
      await screen.findByRole('status', { name: 'Loading questions' });
      expect(prompt()).toBeNull();
    });

    it('is absent when the list fails', async () => {
      render(
        {
          'discussion.listQuestions': () => {
            throw new ApiError('INTERNAL_SERVER_ERROR', 'Boom');
          },
        },
        { firstLessonPrompt: PROMPT },
      );
      await screen.findByText("Couldn't load the questions");
      expect(prompt()).toBeNull();
    });

    it('is absent with a thread open', async () => {
      const { user } = render({}, { firstLessonPrompt: PROMPT });
      await screen.findByRole('group', { name: PROMPT });
      await user.click(
        await screen.findByRole('button', { name: 'Open question' }),
      );
      await waitFor(() => expect(prompt()).toBeNull());
    });

    it('labels a prompt answer in the list', async () => {
      render({
        'discussion.listQuestions': () => ({
          items: [question({ promptAnswer: true })],
        }),
      });
      expect(
        await screen.findByText('Answer to the course prompt'),
      ).toBeInTheDocument();
    });
  });

  it('has no arrow icons in its buttons', async () => {
    const { container } = render();
    await screen.findByText('What is a basis?');
    expect(container.querySelector('button svg')).toBeNull();
  });
});
