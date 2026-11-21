/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  VideoAnswer,
  VideoQuestion,
} from '@discava/common-web-utils/video-questions';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoQuestionCard } from './video-question-card';

afterEach(cleanup);

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const single: VideoQuestion = {
  questionId: 'q1',
  kind: 'single',
  prompt: doc('Which service runs containers?'),
  options: [
    { optionId: 'a', text: 'EC2' },
    { optionId: 'b', text: 'Fargate' },
  ],
  atSeconds: 90,
  contentHash: 'h1',
};

const multiple: VideoQuestion = {
  ...single,
  questionId: 'q2',
  kind: 'multiple',
  options: [
    { optionId: 'a', text: 'Lambda' },
    { optionId: 'b', text: 'EC2' },
    { optionId: 'c', text: 'Fargate' },
  ],
};

const wrong: VideoAnswer = {
  optionIds: ['a'],
  correct: false,
  correctOptionIds: ['b'],
  explanation: doc('Fargate is serverless'),
};

const setup = (
  props: Partial<Parameters<typeof VideoQuestionCard>[0]> = {},
) => {
  const handlers = {
    onSubmit: vi.fn(),
    onSkip: vi.fn(),
    onContinue: vi.fn(),
    onTryAgain: vi.fn(),
  };
  render(<VideoQuestionCard question={single} {...handlers} {...props} />);
  return { ...handlers, user: userEvent.setup() };
};

describe('VideoQuestionCard unanswered', () => {
  it('shows the heading (focused), prompt and options', () => {
    setup();
    expect(
      screen.getByRole('heading', { name: 'Question at 1:30' }),
    ).toHaveFocus();
    expect(screen.getByText('Which service runs containers?')).toBeVisible();
    expect(screen.getByRole('radio', { name: 'EC2' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Fargate' })).toBeVisible();
  });

  it('numbers the question in an end check', () => {
    setup({ position: { number: 1, total: 2 } });
    expect(
      screen.getByRole('heading', { name: 'Question 1 of 2' }),
    ).toBeVisible();
  });

  it('keeps Submit answer disabled until an option is chosen', async () => {
    const { user, onSubmit } = setup();
    const submit = screen.getByRole('button', { name: 'Submit answer' });
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: 'Fargate' }));
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledWith(['b']);
  });

  it('submits several options for a multiple-choice question', async () => {
    const { user, onSubmit } = setup({ question: multiple });
    expect(screen.getByText('Select all that apply')).toBeVisible();

    await user.click(screen.getByRole('checkbox', { name: 'Lambda' }));
    await user.click(screen.getByRole('checkbox', { name: 'Fargate' }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));

    expect(onSubmit).toHaveBeenCalledWith(['a', 'c']);
  });

  it('skips', async () => {
    const { user, onSkip } = setup();
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('shows the updated note', () => {
    setup({ updated: true });
    expect(screen.getByRole('status')).toHaveTextContent(
      'This question was updated',
    );
  });

  it('has text-only buttons', () => {
    setup();
    for (const button of screen.getAllByRole('button')) {
      expect(button.querySelector('svg')).toBeNull();
    }
  });
});

describe('VideoQuestionCard submitting', () => {
  it('disables the options and Submit, but not Skip', async () => {
    const { user, onSkip } = setup({ pending: true });
    expect(screen.getByRole('radio', { name: 'EC2' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Submit answer' }),
    ).toBeDisabled();
    const skip = screen.getByRole('button', { name: 'Skip' });
    expect(skip).toBeEnabled();
    await user.click(skip);
    expect(onSkip).toHaveBeenCalled();
  });
});

describe('VideoQuestionCard failed to save', () => {
  it('shows the error, keeps the choice and resubmits with Try again', async () => {
    const { user, onSubmit } = setup({ error: "Couldn't save your answer" });
    // The choice is made before the failure in the real flow.
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save");
    await user.click(screen.getByRole('radio', { name: 'Fargate' }));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onSubmit).toHaveBeenCalledWith(['b']);
    expect(screen.getByRole('button', { name: 'Skip' })).toBeEnabled();
  });
});

describe('VideoQuestionCard answered', () => {
  it('announces Not quite with the correct option and the explanation', () => {
    setup({ answer: wrong });
    expect(screen.getByRole('status')).toHaveTextContent('Not quite');
    expect(screen.getByText('Fargate is serverless')).toBeVisible();
    expect(screen.getByText('(correct answer)')).toBeInTheDocument();
    expect(screen.getByText('(your answer)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeVisible();
  });

  it('announces Correct', () => {
    setup({
      answer: { optionIds: ['b'], correct: true, correctOptionIds: ['b'] },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Correct');
    expect(screen.queryByText('Explanation')).toBeNull();
  });

  it('continues', async () => {
    const { user, onContinue } = setup({ answer: wrong });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('practises without recording: check, then close', async () => {
    const { user, onSubmit, onContinue, onTryAgain } = setup({ answer: wrong });

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onTryAgain).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Practice: this answer isn't recorded"),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Check answer' })).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: 'Fargate' }));
    await user.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(screen.getByRole('status')).toHaveTextContent('Correct');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onContinue).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
