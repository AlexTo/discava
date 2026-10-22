/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Quiz,
  QuizAttempt,
  QuizSummary,
} from '@discava/common-web-utils/quiz';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuizCard, type QuizCardProps } from './quiz-card';

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const quiz = (overrides: Partial<Quiz> = {}): Quiz => ({
  title: 'Week 1 check',
  questions: [
    {
      questionId: 'q1',
      kind: 'single',
      prompt: doc('Which runs containers serverlessly?'),
      options: [
        { optionId: 'ec2', text: 'EC2' },
        { optionId: 'fargate', text: 'Fargate' },
      ],
    },
    {
      questionId: 'q2',
      kind: 'multiple',
      prompt: doc('Which are serverless?'),
      options: [
        { optionId: 'lambda', text: 'Lambda' },
        { optionId: 'rds', text: 'RDS' },
        { optionId: 'sqs', text: 'SQS' },
      ],
    },
  ],
  settings: {
    passMarkPercent: 50,
    attemptsAllowed: 3,
    shuffleOptions: false,
    revealAnswers: 'after_each_attempt',
  },
  questionsHash: 'hash-1',
  ...overrides,
});

const attempt = (overrides: Partial<QuizAttempt> = {}): QuizAttempt => ({
  answers: { q1: ['fargate'], q2: ['lambda'] },
  correctQuestionIds: ['q1'],
  scorePercent: 50,
  passed: true,
  submittedAt: '2026-10-21T00:00:00.000Z',
  ...overrides,
});

const summary = (overrides: Partial<QuizSummary> = {}): QuizSummary => ({
  attemptsUsed: 1,
  attemptsAllowed: 3,
  bestScore: 50,
  passedAt: '2026-10-21T00:00:00.000Z',
  ...overrides,
});

const reveal = {
  q1: { correctOptionIds: ['fargate'], explanation: doc('Fargate is.') },
  q2: { correctOptionIds: ['lambda', 'sqs'] },
};

const props = (overrides: Partial<QuizCardProps> = {}): QuizCardProps => ({
  quiz: quiz(),
  summary: null,
  lastAttempt: null,
  reveal: null,
  quizKey: 'quiz-1',
  onSubmit: vi.fn(async () => ({
    status: 'submitted' as const,
    attempt: attempt(),
    summary: summary(),
    reveal,
  })),
  ...overrides,
});

const show = (overrides: Partial<QuizCardProps> = {}) => {
  const p = props(overrides);
  const result = render(<QuizCard {...p} />);
  return { ...result, props: p, user: userEvent.setup() };
};

const button = (name: string | RegExp) => screen.getByRole('button', { name });

// Answers both questions: Fargate, then Lambda.
const answerAll = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(button('Start quiz'));
  await user.click(screen.getByRole('radio', { name: 'Fargate' }));
  await user.click(button('Next'));
  expect(screen.getByText('Select all that apply')).toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: 'Lambda' }));
  await user.click(button('Review answers'));
};

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('QuizCard', () => {
  it('summarises the quiz before the first attempt', () => {
    show();

    expect(
      screen.getByText('2 questions · Pass 50% · 0 of 3 attempts used'),
    ).toBeInTheDocument();
    expect(button('Start quiz')).toBeEnabled();
  });

  it('takes one question at a time, then submits the answers for grading', async () => {
    const { user, props: p } = show();

    await answerAll(user);
    expect(screen.getByText(/2 of 2 questions answered/)).toBeInTheDocument();
    await user.click(button('Submit'));

    expect(p.onSubmit).toHaveBeenCalledWith(
      { q1: ['fargate'], q2: ['lambda'] },
      'hash-1',
    );
    expect(await screen.findByText(/This attempt: 50%/)).toBeInTheDocument();
  });

  it('flags unanswered questions on the review screen', async () => {
    const { user } = show();

    await user.click(button('Start quiz'));
    await user.click(button('Next'));
    await user.click(button('Review answers'));

    expect(screen.getAllByText('Unanswered')).toHaveLength(2);
  });

  it('shows each question right or wrong, and the answers once revealed', async () => {
    const { user } = show();

    await answerAll(user);
    await user.click(button('Submit'));

    const [first, second] = await screen
      .findAllByRole('listitem', {
        name: undefined,
      })
      .then((items) =>
        items.filter((li) => li.textContent?.includes('Question')),
      );
    expect(within(first).getByText('Correct')).toBeInTheDocument();
    expect(within(first).getByText('Fargate is.')).toBeInTheDocument();
    expect(within(second).getByText('Incorrect')).toBeInTheDocument();
    expect(within(second).getAllByText('(correct answer)')).toHaveLength(2);
  });

  it('says a lower retake doesn’t replace the best score', async () => {
    const { user } = show({
      summary: summary({ bestScore: 100 }),
      lastAttempt: attempt({ scorePercent: 100 }),
      onSubmit: vi.fn(async () => ({
        status: 'submitted' as const,
        attempt: attempt({ scorePercent: 50 }),
        summary: summary({ attemptsUsed: 2, bestScore: 100 }),
        reveal: null,
      })),
    });

    await user.click(button('Retake quiz'));
    await user.click(button('Next'));
    await user.click(button('Review answers'));
    await user.click(button('Submit'));

    expect(
      await screen.findByText('Your best score of 100% still counts.'),
    ).toBeInTheDocument();
  });

  it('can’t be started with no attempts left, or when closed', () => {
    show({ summary: summary({ attemptsUsed: 3 }) });
    expect(button('No attempts remaining')).toBeDisabled();
    cleanup();

    show({ closedReason: 'This course is archived.' });
    expect(screen.getByText('This course is archived.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start quiz' })).toBeNull();
  });

  it('keeps answers in progress across a reload', async () => {
    const { user } = show();
    await user.click(button('Start quiz'));
    await user.click(screen.getByRole('radio', { name: 'Fargate' }));
    cleanup();

    const again = show();
    await again.user.click(button('Resume quiz'));
    expect(screen.getByRole('radio', { name: 'Fargate' })).toBeChecked();
  });

  it('carries answers over to edited questions and marks them', async () => {
    const {
      user,
      rerender,
      props: p,
    } = show({
      onSubmit: vi.fn(async () => ({ status: 'updated' as const })),
    });
    await answerAll(user);
    await user.click(button('Submit'));

    const edited = quiz({
      questionsHash: 'hash-2',
      questions: [
        quiz().questions[0],
        { ...quiz().questions[1], prompt: doc('Which are managed?') },
        {
          questionId: 'q3',
          kind: 'single',
          prompt: doc('New one'),
          options: [{ optionId: 'x', text: 'X' }],
        },
      ],
    });
    rerender(<QuizCard {...p} quiz={edited} />);

    expect(
      await screen.findByText('This quiz was updated'),
    ).toBeInTheDocument();
    expect(screen.getByText('Updated')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText(/2 of 3 questions answered/)).toBeInTheDocument();
  });

  it('drops the draft when the quiz can’t be taken any more', async () => {
    const { user } = show({
      onSubmit: vi.fn(async () => ({
        status: 'error' as const,
        message: 'This quiz is no longer available',
        closed: true,
      })),
    });
    await answerAll(user);
    await user.click(button('Submit'));

    expect(
      await screen.findByText('This quiz is no longer available'),
    ).toBeInTheDocument();
    expect(localStorage.getItem('discava:quiz-draft:quiz-1')).toBeNull();
  });

  it('shuffles options in an order that holds for the attempt', async () => {
    const options = Array.from({ length: 6 }, (_, i) => ({
      optionId: `o${i}`,
      text: `Option ${i}`,
    }));
    const shuffledQuiz = quiz({
      settings: { ...quiz().settings, shuffleOptions: true },
      questions: [
        { questionId: 'q1', kind: 'single', prompt: doc('Pick'), options },
      ],
    });
    const order = () =>
      screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'));

    const { user } = show({ quiz: shuffledQuiz });
    await user.click(button('Start quiz'));
    const first = order();
    expect(first).not.toEqual(options.map((o) => o.optionId));
    cleanup();

    const again = show({ quiz: shuffledQuiz });
    await again.user.click(button('Resume quiz'));
    expect(order()).toEqual(first);
  });
});
