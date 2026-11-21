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
import { FirstLessonPrompt } from './first-lesson-prompt';

const AT = '2026-10-05T12:00:00.000Z';
const PROMPT = 'What do you hope to learn?';
const enrolment = {
  courseId: 'course-1',
  userId: 'student-1',
  status: 'active',
  progressPercent: 0,
  createdAt: AT,
  updatedAt: AT,
};
const ENROLMENT_KEY = [
  ['course', 'myEnrolment'],
  { input: { courseId: 'course-1' }, type: 'query' },
];

// The enrolment is seeded in the cache, as the lesson page leaves it.
const render = (handlers: Record<string, Handler> = {}) => {
  const view = renderWithCoreApi(
    <FirstLessonPrompt
      lesson={{
        courseId: 'course-1',
        moduleId: 'module-1',
        lessonId: 'lesson-1',
      }}
      prompt={PROMPT}
    />,
    { handlers },
  );
  view.queryClient.setQueryData(ENROLMENT_KEY, enrolment);
  return view;
};

const cachedState = (queryClient: {
  getQueryData: (key: unknown[]) => unknown;
}) =>
  (
    queryClient.getQueryData(ENROLMENT_KEY) as
      | { firstLessonPromptState?: string }
      | undefined
  )?.firstLessonPromptState;

const post = () => screen.getByRole('button', { name: 'Post' });

describe('FirstLessonPrompt', () => {
  it('shows the prompt as the legend, the field, the count and the note', async () => {
    render();
    expect(
      await screen.findByRole('group', { name: PROMPT }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Your answer')).toHaveAttribute(
      'maxLength',
      '4000',
    );
    expect(screen.getByText('0 / 4,000')).toBeInTheDocument();
    expect(
      screen.getByText('Everyone in this course can read your answer.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Your answer')).not.toHaveFocus();
  });

  it('has no arrow icons in its buttons', async () => {
    const { container } = render();
    await screen.findByLabelText('Your answer');
    expect(container.querySelector('button svg')).toBeNull();
  });

  it('disables Post while blank and while the request runs', async () => {
    const { user } = render({
      'discussion.answerPrompt': () => new Promise(() => {}),
    });
    await screen.findByLabelText('Your answer');
    expect(post()).toBeDisabled();
    await user.type(screen.getByLabelText('Your answer'), '   ');
    expect(post()).toBeDisabled();
    await user.type(screen.getByLabelText('Your answer'), 'To code');
    expect(post()).toBeEnabled();
    await user.click(post());
    await waitFor(() => expect(post()).toBeDisabled());
  });

  it('posts the answer with a post id and marks the enrolment answered', async () => {
    const { user, calls, queryClient } = render({
      'discussion.answerPrompt': () => ({}),
    });
    await user.type(await screen.findByLabelText('Your answer'), 'To code');
    await user.click(post());
    await waitFor(() => expect(cachedState(queryClient)).toBe('answered'));
    expect(
      calls.find((c) => c.path === 'discussion.answerPrompt')?.input,
    ).toEqual({
      courseId: 'course-1',
      moduleId: 'module-1',
      lessonId: 'lesson-1',
      postId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7/),
      body: 'To code',
    });
  });

  it('dismisses with Not now and writes the result to the enrolment cache', async () => {
    const { user, calls, queryClient } = render({
      'course.dismissFirstLessonPrompt': () => ({
        ...enrolment,
        firstLessonPromptState: 'dismissed',
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(cachedState(queryClient)).toBe('dismissed'));
    expect(
      calls.find((c) => c.path === 'course.dismissFirstLessonPrompt')?.input,
    ).toEqual({ courseId: 'course-1' });
  });

  it('refetches the enrolment and shows no error on PRECONDITION_FAILED', async () => {
    const { user, queryClient } = render({
      'discussion.answerPrompt': () => {
        throw new ApiError('PRECONDITION_FAILED', 'Already closed');
      },
    });
    await user.type(await screen.findByLabelText('Your answer'), 'To code');
    await user.click(post());
    await waitFor(() =>
      expect(queryClient.getQueryState(ENROLMENT_KEY)?.isInvalidated).toBe(
        true,
      ),
    );
    expect(screen.queryByText('Already closed')).toBeNull();
  });

  it('shows another failure and keeps the text', async () => {
    const { user } = render({
      'discussion.answerPrompt': () => {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'Boom');
      },
    });
    await user.type(await screen.findByLabelText('Your answer'), 'To code');
    await user.click(post());
    expect(await screen.findByText('Boom')).toBeInTheDocument();
    expect(screen.getByLabelText('Your answer')).toHaveValue('To code');
    expect(screen.getByRole('button', { name: 'Not now' })).toBeEnabled();
  });
});
