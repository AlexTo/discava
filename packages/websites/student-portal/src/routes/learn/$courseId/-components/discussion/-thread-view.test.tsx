/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  type Handler,
  renderWithCoreApi,
} from '../../../../../test/render-with-core-api';
import { ThreadView } from './thread-view';

const AT = '2026-10-05T12:00:00.000Z';
const lesson = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
};

const post = (overrides: Record<string, unknown> = {}) => ({
  postId: 'r-1',
  threadId: 'q-1',
  kind: 'reply',
  state: 'shown',
  authorName: 'Bob K.',
  authorIsInstructor: false,
  body: 'Try the basics.',
  createdAt: AT,
  voteCount: 1,
  upvotedByMe: false,
  mine: false,
  ...overrides,
});

const question = (overrides: Record<string, unknown> = {}) =>
  post({
    postId: 'q-1',
    kind: 'question',
    authorName: 'Ada L.',
    title: 'What is a basis?',
    body: 'I am lost.',
    ...overrides,
  });

const render = (
  thread: Record<string, unknown>,
  handlers: Record<string, Handler> = {},
  { readOnly = false } = {},
) =>
  renderWithCoreApi(
    <ThreadView
      lesson={lesson}
      threadId="q-1"
      readOnly={readOnly}
      onBack={() => {}}
    />,
    {
      handlers: {
        'discussion.thread': () => ({
          question: question(),
          replies: [],
          ...thread,
        }),
        ...handlers,
      },
    },
  );

const ref = { ...lesson, threadId: 'q-1', postId: 'r-1' };
const buttons = () =>
  screen.getAllByRole('button').map((button) => button.textContent);

describe('ThreadView', () => {
  it('lists the replies in the order given, with the Instructor badge', async () => {
    render({
      replies: [
        post({ postId: 'r-1', body: 'First' }),
        post({ postId: 'r-2', body: 'Second', authorIsInstructor: true }),
      ],
    });
    expect(await screen.findByText('First')).toBeInTheDocument();
    const texts = screen
      .getAllByText(/^(First|Second)$/)
      .map((n) => n.textContent);
    expect(texts).toEqual(['First', 'Second']);
    expect(screen.getAllByText('Instructor')).toHaveLength(1);
  });

  it('loads more replies with the cursor', async () => {
    const { user, calls } = render(
      {},
      {
        'discussion.thread': (input) =>
          (input as { cursor?: string }).cursor
            ? {
                question: question(),
                replies: [post({ postId: 'r-9', body: 'Later' })],
              }
            : { question: question(), replies: [post()], cursor: 'c2' },
      },
    );
    // Waits longer than the default: CI runs this file beside much heavier ones.
    await user.click(
      await screen.findByRole(
        'button',
        { name: 'Load more' },
        { timeout: 10_000 },
      ),
    );
    expect(
      await screen.findByText('Later', undefined, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Try the basics.')).toBeInTheDocument();
    expect(
      calls.filter((c) => c.path === 'discussion.thread')[1].input,
    ).toEqual(
      expect.objectContaining({ ...lesson, threadId: 'q-1', cursor: 'c2' }),
    );
  });

  it('shows the accepted answer first and does not repeat it', async () => {
    render({
      accepted: post({ postId: 'r-2', body: 'The answer' }),
      replies: [post({ postId: 'r-1', body: 'Other' })],
    });
    expect(await screen.findByText('Accepted answer')).toBeInTheDocument();
    const texts = screen
      .getAllByText(/^(The answer|Other)$/)
      .map((n) => n.textContent);
    expect(texts).toEqual(['The answer', 'Other']);
  });

  it('shows only the placeholder for a hidden question', async () => {
    render({
      question: question({
        state: 'hidden',
        title: undefined,
        body: undefined,
      }),
      replies: [],
    });
    expect(
      await screen.findByText('This post was hidden by an instructor.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Your reply')).toBeNull();
    expect(buttons()).toEqual(['Back to questions']);
  });

  it('upvotes another’s post and removes the upvote', async () => {
    const { user, calls } = render(
      { replies: [post({ upvotedByMe: true })] },
      { 'discussion.vote': () => ({ voteCount: 0, upvotedByMe: false }) },
    );
    await user.click(
      await screen.findByRole('button', { name: 'Remove upvote' }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.path === 'discussion.vote')?.input).toEqual({
        ...ref,
        voted: false,
      }),
    );
  });

  it('reports another’s post and then shows Reported', async () => {
    const { user, calls } = render(
      { replies: [post()] },
      { 'discussion.report': () => ({ reported: true }) },
    );
    const reply = (await screen.findByText('Try the basics.')).closest('div')!
      .parentElement!;
    await user.click(within(reply).getByRole('button', { name: 'Report' }));
    expect(
      await within(reply).findByRole('button', { name: 'Reported' }),
    ).toBeDisabled();
    expect(calls.find((c) => c.path === 'discussion.report')?.input).toEqual(
      ref,
    );
  });

  it('offers no upvote, report or accept on one’s own reply, only Delete', async () => {
    render({
      question: question({ mine: true }),
      replies: [post({ mine: true })],
    });
    await screen.findByText('Try the basics.');
    expect(screen.queryByRole('button', { name: 'Upvote' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Report' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);
  });

  it('deletes one’s own reply after a confirmation naming it', async () => {
    const { user, calls } = render(
      { replies: [post({ mine: true })] },
      { 'discussion.removeOwn': () => post({ state: 'deleted' }) },
    );
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete your reply?')).toBeInTheDocument();
    expect(calls.some((c) => c.path === 'discussion.removeOwn')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Delete reply' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.path === 'discussion.removeOwn')?.input,
      ).toEqual(ref),
    );
  });

  it('names the question when deleting one’s own question', async () => {
    const { user } = render({ question: question({ mine: true }) });
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(
      await screen.findByText('Delete your question?'),
    ).toBeInTheDocument();
  });

  it('lets the question’s author mark and remove the answer', async () => {
    const { user, calls } = render(
      {
        question: question({ mine: true }),
        accepted: post({ postId: 'r-2', body: 'The answer' }),
        replies: [post()],
      },
      { 'discussion.accept': () => question() },
    );
    await user.click(
      await screen.findByRole('button', { name: 'Mark as answer' }),
    );
    await user.click(screen.getByRole('button', { name: 'Remove answer' }));
    await waitFor(() =>
      expect(
        calls.filter((c) => c.path === 'discussion.accept').map((c) => c.input),
      ).toEqual([
        { ...lesson, threadId: 'q-1', postId: 'r-1' },
        { ...lesson, threadId: 'q-1', postId: null },
      ]),
    );
  });

  it('has no Mark as answer for someone else’s question', async () => {
    render({ replies: [post()] });
    await screen.findByText('Try the basics.');
    expect(screen.queryByRole('button', { name: 'Mark as answer' })).toBeNull();
  });

  it('posts a reply with a UUID v7 id and clears the form', async () => {
    const { user, calls } = render({}, { 'discussion.reply': () => post() });
    await user.type(await screen.findByLabelText('Your reply'), 'Thanks');
    await user.click(screen.getByRole('button', { name: 'Post reply' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Your reply')).toHaveValue(''),
    );
    expect(calls.find((c) => c.path === 'discussion.reply')?.input).toEqual({
      ...lesson,
      threadId: 'q-1',
      postId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7/),
      body: 'Thanks',
    });
  });

  it('keeps the form and the post id when the reply fails, showing the message', async () => {
    const { user, calls } = render(
      {},
      {
        'discussion.reply': () => {
          throw new ApiError(
            'PRECONDITION_FAILED',
            'This question has reached its reply limit',
          );
        },
      },
    );
    await user.type(await screen.findByLabelText('Your reply'), 'Thanks');
    await user.click(screen.getByRole('button', { name: 'Post reply' }));
    expect(
      await screen.findByText('This question has reached its reply limit'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Your reply')).toHaveValue('Thanks');
    await user.click(screen.getByRole('button', { name: 'Post reply' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.path === 'discussion.reply')).toHaveLength(
        2,
      ),
    );
    const ids = calls
      .filter((c) => c.path === 'discussion.reply')
      .map((c) => (c.input as { postId: string }).postId);
    expect(ids[0]).toBe(ids[1]);
  });

  it('shows a failing action’s message', async () => {
    const { user } = render(
      { replies: [post()] },
      {
        'discussion.vote': () => {
          throw new ApiError('NOT_FOUND', 'Gone');
        },
      },
    );
    await user.click(
      (await screen.findAllByRole('button', { name: 'Upvote' }))[1],
    );
    expect(await screen.findByText('Gone')).toBeInTheDocument();
  });

  it('is read-only for an archived course except Delete of one’s own post', async () => {
    render(
      {
        question: question({ mine: true }),
        replies: [post(), post({ postId: 'r-2', mine: true, body: 'Mine' })],
      },
      {},
      { readOnly: true },
    );
    await screen.findByText('Try the basics.');
    expect(screen.queryByLabelText('Your reply')).toBeNull();
    for (const name of ['Upvote', 'Report', 'Mark as answer', 'Post reply']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);
  });

  it('shows an error with Try again', async () => {
    let fail = true;
    const { user } = render(
      {},
      {
        'discussion.thread': () => {
          if (fail) {
            throw new ApiError('INTERNAL_SERVER_ERROR', 'Boom');
          }
          return { question: question(), replies: [] };
        },
      },
    );
    expect(
      await screen.findByText("Couldn't load the question"),
    ).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('What is a basis?')).toBeInTheDocument();
  });
});
