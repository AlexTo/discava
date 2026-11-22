/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ApiError } from '@discava/common-web-utils/testing';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  lessonsView,
  renderQuestions,
} from '../../../../../../test/render-questions';
import { UnansweredView } from './unanswered-view';

const row = (n: number, extra = {}) => ({
  postId: `q${n}`,
  threadId: `q${n}`,
  kind: 'question',
  state: 'shown',
  authorName: `Student ${n}`,
  authorIsInstructor: false,
  title: `Question ${n}`,
  body: 'Help',
  createdAt: new Date().toISOString(),
  voteCount: 0,
  replyCount: 2,
  mine: false,
  reportCount: 0,
  moduleId: 'm1',
  lessonId: 'l1',
  lessonTitle: 'Lesson l1',
  ...extra,
});

const render = (instructor: Record<string, (input: unknown) => unknown>) =>
  renderQuestions(<UnansweredView courseId="c1" />, {
    instructor: {
      'course.view': () =>
        lessonsView([
          { lessonId: 'l1' },
          { lessonId: 'l2', state: 'archived' },
        ]),
      ...instructor,
    },
  });

describe('UnansweredView', () => {
  it('lists title, lesson, author, age and reply count', async () => {
    render({ 'discussion.unanswered': () => ({ items: [row(1)] }) });

    expect(await screen.findByText('Question 1')).toBeVisible();
    expect(screen.getByText(/Lesson l1/)).toBeVisible();
    expect(screen.getByText(/Student 1/)).toBeVisible();
    expect(screen.getByText(/2 replies/)).toBeVisible();
  });

  it('labels the lesson when it is archived', async () => {
    render({
      'discussion.unanswered': () => ({
        items: [row(1, { lessonId: 'l2', lessonTitle: 'Lesson l2' })],
      }),
    });

    expect(await screen.findByText(/Lesson l2 \(archived\)/)).toBeVisible();
  });

  it('keeps the thread open when answering takes the question out of the queue', async () => {
    let answered = false;
    const rendered = renderQuestions(<UnansweredView courseId="c1" />, {
      instructor: {
        'course.view': () => lessonsView([{ lessonId: 'l1' }]),
        'discussion.unanswered': () => ({ items: answered ? [] : [row(1)] }),
      },
      core: {
        'discussion.thread': () => ({
          question: { ...row(1), replyCount: 0 },
          replies: [],
        }),
      },
    });

    await rendered.user.click(
      await screen.findByRole('button', { name: /^Open question/ }),
    );
    expect(await screen.findByRole('dialog')).toBeVisible();
    // The portal's two API clients share one query cache, so a reply's refresh
    // reaches the queue too.
    answered = true;
    await rendered.queryClient.invalidateQueries({
      queryKey: rendered.optionsProxy.discussion.unanswered.pathKey(),
    });

    await waitFor(() =>
      expect(screen.getByText('All questions are answered.')).toBeVisible(),
    );
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('shows the empty state', async () => {
    render({ 'discussion.unanswered': () => ({ items: [] }) });
    expect(
      await screen.findByText('All questions are answered.'),
    ).toBeVisible();
  });

  it('loads more', async () => {
    const { user, calls } = render({
      'discussion.unanswered': (input) =>
        (input as { cursor?: string }).cursor
          ? { items: [row(2)] }
          : { items: [row(1)], cursor: 'c1' },
    });

    await user.click(await screen.findByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Question 2')).toBeVisible();
    expect(
      calls.filter((c) => c.path === 'discussion.unanswered'),
    ).toHaveLength(2);
  });

  it('shows an error with a retry', async () => {
    let fail = true;
    const { user } = render({
      'discussion.unanswered': () => {
        if (fail) {
          throw new ApiError('INTERNAL_SERVER_ERROR', 'Boom');
        }
        return { items: [row(1)] };
      },
    });

    expect(
      await screen.findByText(
        'Something went wrong on our side. Try again in a moment.',
      ),
    ).toBeVisible();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Question 1')).toBeVisible();
  });
});
