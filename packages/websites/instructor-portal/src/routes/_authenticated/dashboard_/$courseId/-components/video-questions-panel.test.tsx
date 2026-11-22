/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../test/render-with-instructor-api';
import { VideoQuestionsPanel } from './video-questions-panel';

const videos = [
  { contentItemId: 'v1', title: 'Welcome', questions: 3 },
  { contentItemId: 'v2', title: 'Recap', questions: 1 },
];

const question = (
  questionId: string,
  atSeconds: number | null,
  attempts: number,
  misses: number,
) => ({
  questionId,
  text: `Question ${questionId}`,
  atSeconds,
  attempts,
  misses,
  missRate: attempts > 0 ? Math.floor((misses * 100) / attempts) : null,
  ranked: attempts >= 5,
});

const figures = () => ({
  questions: [
    question('q2', null, 8, 6),
    question('q1', 90, 5, 1),
    question('q3', 3725, 2, 2),
  ],
});

const renderPanel = (
  handler: (input: unknown) => unknown = () => figures(),
  list = videos,
) =>
  renderWithInstructorApi(<VideoQuestionsPanel courseId="c1" videos={list} />, {
    handlers: { 'analytics.videoQuestions': handler },
  });

const choose = (user: ReturnType<typeof renderPanel>['user'], title: string) =>
  user.click(screen.getByRole('button', { name: `Show results for ${title}` }));

describe('VideoQuestionsPanel', () => {
  it('lists the videos with their question counts and reads nothing until one is chosen', () => {
    const { calls } = renderPanel();

    expect(screen.getByText('Welcome')).toBeInTheDocument();
    expect(screen.getByText('3 questions')).toBeInTheDocument();
    expect(screen.getByText('Recap')).toBeInTheDocument();
    expect(screen.getByText('1 question')).toBeInTheDocument();
    expect(
      calls.filter(({ path }) => path === 'analytics.videoQuestions'),
    ).toHaveLength(0);
  });

  it('loads the chosen video and lists each question with its moment, answers, misses and miss rate', async () => {
    const { user, calls } = renderPanel();
    await choose(user, 'Welcome');

    const table = await screen.findByRole('table', {
      name: 'Question results for Welcome',
    });
    expect(
      calls.find(({ path }) => path === 'analytics.videoQuestions')?.input,
    ).toEqual({ courseId: 'c1', contentItemId: 'v1' });
    const cells = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      );
    expect(cells[0]).toEqual([
      '1',
      'End of video',
      'Question q2',
      '8',
      '6',
      '75%',
    ]);
    expect(cells[1]).toEqual(['2', '1:30', 'Question q1', '5', '1', '20%']);
  });

  it('says "Not enough answers yet" under 5 answers, with no rank or rate', async () => {
    const { user } = renderPanel();
    await choose(user, 'Welcome');

    const table = await screen.findByRole('table', {
      name: 'Question results for Welcome',
    });
    const last = within(table).getAllByRole('row')[3];
    expect(last).toHaveTextContent('1:02:05');
    expect(last).toHaveTextContent('Not enough answers yet');
    expect(last).not.toHaveTextContent('100%');
    expect(within(last).getAllByRole('cell')[0]).toHaveTextContent('–');
  });

  it('closes the results again', async () => {
    const { user } = renderPanel();
    await choose(user, 'Welcome');
    await screen.findByRole('table');
    await user.click(
      screen.getByRole('button', { name: 'Hide results for Welcome' }),
    );
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says so when no video has questions', () => {
    renderPanel(() => figures(), []);
    expect(
      screen.getByText('No videos with questions are shown to learners yet.'),
    ).toBeInTheDocument();
  });

  it('shows the error with a retry when the figures fail', async () => {
    let fail = true;
    const { user } = renderPanel(() => {
      if (fail) {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'Something broke');
      }
      return figures();
    });
    await choose(user, 'Welcome');
    expect(await screen.findByText("Couldn't load this video")).toBeVisible();

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByRole('table', {
        name: 'Question results for Welcome',
      }),
    ).toBeInTheDocument();
  });
});
