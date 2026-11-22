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
import { QuizPanel } from './quiz-panel';

const quiz = {
  contentItemId: 'quiz-1',
  lessonId: 'l1',
  title: 'Checkpoint',
  students: 6,
};

const question = (
  questionId: string,
  attempts: number,
  misses: number,
  ranked = attempts >= 5,
) => ({
  questionId,
  text: `Question ${questionId}`,
  attempts,
  misses,
  missRate: attempts > 0 ? Math.floor((misses * 100) / attempts) : null,
  ranked,
});

const bands = (students: Record<number, number> = {}) =>
  Array.from({ length: 10 }, (_, band) => ({
    from: band * 10,
    to: band === 9 ? 100 : band * 10 + 9,
    students: students[band] ?? 0,
  }));

const figures = (overrides: Record<string, unknown> = {}) => ({
  questions: [question('q2', 8, 6), question('q1', 5, 1), question('q3', 2, 2)],
  scoreBands: bands({ 4: 1, 8: 5 }),
  students: 6,
  ...overrides,
});

const renderPanel = (handler: (input: unknown) => unknown = () => figures()) =>
  renderWithInstructorApi(<QuizPanel courseId="c1" quiz={quiz} />, {
    handlers: { 'analytics.quiz': handler },
  });

const open = async (user: ReturnType<typeof renderPanel>['user']) =>
  user.click(screen.getByRole('button', { name: /Show analysis/ }));

describe('QuizPanel', () => {
  it('names the quiz, and reads nothing until it is opened', () => {
    const { calls } = renderPanel();

    expect(screen.getByText('Checkpoint')).toBeInTheDocument();
    expect(screen.getByText('6 students')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Show analysis/ }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(calls.filter(({ path }) => path === 'analytics.quiz')).toHaveLength(
      0,
    );
  });

  it('asks for the quiz when opened and lists the questions in the order given, with rank, attempts, misses and miss rate', async () => {
    const { user, calls } = renderPanel();
    await open(user);

    const table = await screen.findByRole('table', {
      name: 'Most-missed questions for Checkpoint',
    });
    expect(calls.find(({ path }) => path === 'analytics.quiz')?.input).toEqual({
      courseId: 'c1',
      contentItemId: 'quiz-1',
    });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    const cells = rows.map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    );
    expect(cells[0]).toEqual(['1', 'Question q2', '8', '6', '75%']);
    expect(cells[1]).toEqual(['2', 'Question q1', '5', '1', '20%']);
  });

  it('says "Not enough attempts" for a question under 5 attempts, with no rank or rate', async () => {
    const { user } = renderPanel();
    await open(user);

    const table = await screen.findByRole('table', {
      name: 'Most-missed questions for Checkpoint',
    });
    const last = within(table).getAllByRole('row')[3];
    expect(last).toHaveTextContent('Question q3');
    expect(last).toHaveTextContent('Not enough attempts');
    expect(last).not.toHaveTextContent('100%');
    expect(within(last).getAllByRole('cell')[0]).toHaveTextContent('–');
  });

  it('shows ten score bars with a text alternative', async () => {
    const { user } = renderPanel();
    await open(user);

    const scores = await screen.findByRole('table', {
      name: 'Best scores for Checkpoint',
    });
    const rows = within(scores).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toHaveTextContent('0-9');
    expect(rows[4]).toHaveTextContent('40-49');
    expect(rows[4]).toHaveTextContent('1');
    expect(rows[8]).toHaveTextContent('80-89');
    expect(rows[8]).toHaveTextContent('5');
    expect(rows[9]).toHaveTextContent('90-100');
  });

  it('says so when nobody has attempted the quiz', async () => {
    const { user } = renderPanel(() =>
      figures({
        questions: [question('q1', 0, 0), question('q2', 0, 0)],
        scoreBands: bands(),
        students: 0,
      }),
    );
    await open(user);

    expect(
      await screen.findByText('Nobody has attempted this quiz yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('closes again', async () => {
    const { user } = renderPanel();
    await open(user);
    await screen.findByRole('table', {
      name: 'Most-missed questions for Checkpoint',
    });

    await user.click(screen.getByRole('button', { name: /Hide analysis/ }));
    expect(screen.queryByRole('table', { name: /Most-missed/ })).toBeNull();
  });

  it('shows an error with a Retry that asks again', async () => {
    let attempt = 0;
    const { user } = renderPanel(() => {
      if (++attempt === 1) {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'Something broke');
      }
      return figures();
    });
    await open(user);

    expect(
      await screen.findByText(
        'Something went wrong on our side. Try again in a moment.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByRole('table', {
        name: 'Most-missed questions for Checkpoint',
      }),
    ).toBeInTheDocument();
  });
});
