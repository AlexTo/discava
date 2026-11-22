/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { PlayerCue } from '@discava/common-web-utils/video-questions';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithInstructorApi } from '../../../../../../../test/render-with-instructor-api';
import type { VideoQuestionState } from './video-questions-form';
import { VideoQuestionsPreview } from './video-questions-preview';

// No playback in jsdom: a stand-in that offers each cue as a button and shows
// the overlay it is given.
vi.mock('@discava/common-shadcn/components/hls-video', () => ({
  HlsVideo: ({
    cues,
    onCue,
    overlay,
  }: {
    cues?: PlayerCue[];
    onCue?: (ids: string[], reason: 'reached' | 'chosen' | 'ended') => void;
    overlay?: ReactNode;
  }) => (
    <div>
      {cues?.map((cue) => (
        <button
          key={cue.id}
          type="button"
          onClick={() => onCue?.([cue.id], 'reached')}
        >
          {cue.label}
        </button>
      ))}
      {overlay}
    </div>
  ),
}));

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const question: VideoQuestionState = {
  questionId: 'q1',
  kind: 'single',
  prompt: doc('Which is right?'),
  options: [
    { optionId: 'a', text: 'Wrong' },
    { optionId: 'b', text: 'Right' },
  ],
  correct: ['b'],
  explanation: doc('Because.'),
  atSeconds: 1,
};

const setup = () => {
  const rendered = renderWithInstructorApi(
    <VideoQuestionsPreview
      url="https://video.example.com/master.m3u8"
      withCredentials={false}
      questions={[question]}
    />,
  );
  return rendered;
};

describe('VideoQuestionsPreview', () => {
  it('asks a question, grades it against the key, and calls nothing', async () => {
    const { user, calls } = setup();
    await user.click(
      screen.getByRole('button', { name: 'Question at 0:01, not answered' }),
    );

    expect(screen.getByText('Which is right?')).toBeVisible();
    await user.click(screen.getByRole('radio', { name: 'Wrong' }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Not quite');
    expect(calls).toEqual([]);
  });

  it('marks the question answered once it is', async () => {
    const { user } = setup();
    await user.click(
      screen.getByRole('button', { name: 'Question at 0:01, not answered' }),
    );
    await user.click(screen.getByRole('radio', { name: 'Right' }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Correct');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      screen.getByRole('button', { name: 'Question at 0:01, answered' }),
    ).toBeVisible();
  });
});
