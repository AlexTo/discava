/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlayerItem } from '../../../../hooks/use-course-player';
import {
  ApiError,
  type Handler,
  renderWithCoreApi,
} from '../../../../test/render-with-core-api';
import { VideoWithQuestions } from './video-questions';

// A player that only asks for what the wrapper hands it: a button reaches the
// first question, as playback would.
const { cueProps } = vi.hoisted(() => ({
  cueProps: {} as { onCue?: (ids: string[], reason: string) => void },
}));
vi.mock('@discava/common-shadcn/components/hls-video', () => ({
  HlsVideo: ({ cues, onCue, overlay }: any) => {
    cueProps.onCue = onCue;
    return (
      <div data-testid="player" data-cues={cues?.length ?? 'none'}>
        {overlay}
      </div>
    );
  },
}));

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const item = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'video-1',
  type: 'video',
  status: 'ready',
  title: 'Containers',
} as PlayerItem;

const question = {
  questionId: 'q1',
  kind: 'single',
  prompt: doc('Which service runs containers?'),
  options: [
    { optionId: 'a', text: 'EC2' },
    { optionId: 'b', text: 'Fargate' },
  ],
  atSeconds: 10,
  contentHash: 'h1',
};

const view = (answers: Record<string, unknown> = {}) => ({
  quizVersion: 1,
  questions: [question],
  answers,
});

const answered = {
  optionIds: ['a'],
  correct: false,
  answeredAt: '2026-11-21T00:00:00.000Z',
  correctOptionIds: ['b'],
  explanation: doc('Fargate is serverless'),
  recorded: true,
};

const render = (handlers: Record<string, Handler> = {}) =>
  renderWithCoreApi(
    <VideoWithQuestions
      item={item}
      url="https://media.test/master.m3u8"
      withCredentials={false}
    />,
    { handlers: { 'videoQuestion.view': () => view(), ...handlers } },
  );

const reach = async () => {
  await waitFor(() =>
    expect(screen.getByTestId('player')).toHaveAttribute('data-cues', '1'),
  );
  act(() => cueProps.onCue?.(['q1'], 'reached'));
};

describe('VideoWithQuestions', () => {
  it('asks a reached question, records the answer and shows the result', async () => {
    const { user, calls } = render({ 'videoQuestion.answer': () => answered });
    await reach();

    expect(
      await screen.findByText('Which service runs containers?'),
    ).toBeVisible();
    await user.click(screen.getByRole('radio', { name: 'EC2' }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));

    expect(await screen.findByText('Not quite')).toBeVisible();
    expect(screen.getByText('Fargate is serverless')).toBeVisible();
    expect(
      calls.find((call) => call.path === 'videoQuestion.answer')?.input,
    ).toEqual({
      courseId: 'course-1',
      moduleId: 'module-1',
      lessonId: 'lesson-1',
      contentItemId: 'video-1',
      questionId: 'q1',
      optionIds: ['a'],
      contentHash: 'h1',
    });
  });

  it('records nothing on Skip', async () => {
    const answer = vi.fn(() => answered);
    const { user } = render({ 'videoQuestion.answer': answer });
    await reach();

    await user.click(await screen.findByRole('button', { name: 'Skip' }));

    expect(answer).not.toHaveBeenCalled();
  });

  it('still plays the video when the questions fail to load', async () => {
    render({
      'videoQuestion.view': () => {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'boom');
      },
    });

    const player = await screen.findByTestId('player');
    await waitFor(() => expect(player).toHaveAttribute('data-cues', '0'));
    act(() => cueProps.onCue?.(['q1'], 'reached'));
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });

  it('shows the updated question after a CONFLICT', async () => {
    let views = 0;
    const { user } = render({
      'videoQuestion.view': () => {
        views += 1;
        return views === 1
          ? view()
          : {
              ...view(),
              questions: [
                {
                  ...question,
                  prompt: doc('A better prompt'),
                  contentHash: 'h2',
                },
              ],
            };
      },
      'videoQuestion.answer': () => {
        throw new ApiError(
          'CONFLICT',
          'This question was updated. Check it before answering',
        );
      },
    });
    await reach();
    await user.click(await screen.findByRole('radio', { name: 'EC2' }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));

    expect(await screen.findByText('A better prompt')).toBeVisible();
    expect(screen.getByText(/This question was updated/)).toBeVisible();
  });

  it('closes the question when it was removed', async () => {
    const { user } = render({
      'videoQuestion.answer': () => {
        throw new ApiError(
          'NOT_FOUND',
          'This question is no longer part of the video',
        );
      },
    });
    await reach();
    await user.click(await screen.findByRole('radio', { name: 'EC2' }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull(),
    );
  });

  it('keeps the choice with an error when saving fails', async () => {
    const { user } = render({
      'videoQuestion.answer': () => {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'boom');
      },
    });
    await reach();
    await user.click(await screen.findByRole('radio', { name: 'EC2' }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));

    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('radio', { name: 'EC2' })).toBeChecked();
  });
});
