/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  VideoAnswer,
  VideoQuestion,
} from '@discava/common-web-utils/video-questions';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVideoQuestions } from './use-video-questions';

afterEach(cleanup);

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const question = (
  questionId: string,
  atSeconds: number | null,
  text = `Prompt ${questionId}`,
): VideoQuestion => ({
  questionId,
  kind: 'single',
  prompt: doc(text),
  options: [
    { optionId: 'a', text: 'Wrong' },
    { optionId: 'b', text: 'Right' },
  ],
  atSeconds,
  contentHash: `h-${questionId}`,
});

const right: VideoAnswer = {
  optionIds: ['b'],
  correct: true,
  correctOptionIds: ['b'],
};

type Hook = ReturnType<typeof useVideoQuestions>;

const setup = ({
  questions = [question('q1', 10), question('q2', 10), question('e1', null)],
  answers = {},
  submit = vi.fn(async () => right),
  onChanged = vi.fn(),
}: Partial<Parameters<typeof useVideoQuestions>[0]> = {}) => {
  const current: { hook?: Hook } = {};
  const Harness = () => {
    current.hook = useVideoQuestions({ questions, answers, submit, onChanged });
    return <div data-testid="overlay">{current.hook.overlay}</div>;
  };
  render(<Harness />);
  return {
    submit,
    onChanged,
    user: userEvent.setup(),
    hook: () => current.hook!,
    cue: (ids: string[], reason: 'reached' | 'chosen' | 'ended' = 'reached') =>
      act(() => current.hook!.onCue(ids, reason)),
  };
};

describe('useVideoQuestions', () => {
  it('builds the cues', () => {
    const { hook } = setup();
    expect(hook().cues.map((c) => [c.id, c.state])).toEqual([
      ['q1', 'unanswered'],
      ['q2', 'unanswered'],
      ['e1', 'unanswered'],
    ]);
  });

  it('shows nothing until a cue is reached', () => {
    const { hook } = setup();
    expect(hook().overlay).toBeUndefined();
  });

  it('asks a reached question, records the answer and shows the result', async () => {
    const { user, cue, submit } = setup();
    cue(['q1']);

    expect(screen.getByText('Prompt q1')).toBeVisible();
    await user.click(screen.getByRole('radio', { name: 'Right' }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: 'q1' }),
      ['b'],
    );
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Correct'),
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByTestId('overlay')).toBeEmptyDOMElement();
  });

  it('asks several cues reached together one after another', async () => {
    const { user, cue } = setup();
    cue(['q1', 'q2']);

    expect(screen.getByText('Prompt q1')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByText('Prompt q2')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByTestId('overlay')).toBeEmptyDOMElement();
  });

  it('records nothing on Skip and does not ask it again', async () => {
    const { user, cue, submit } = setup();
    cue(['q1']);
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(submit).not.toHaveBeenCalled();
    cue(['q1']);
    expect(screen.queryByTestId('overlay')).toBeEmptyDOMElement();
    // Its marker still opens it.
    cue(['q1'], 'chosen');
    expect(screen.getByText('Prompt q1')).toBeVisible();
  });

  it('skips on Escape for an unanswered question and continues for an answered one', async () => {
    const { user, cue, hook, submit } = setup();
    cue(['q1']);
    act(() => hook().onOverlayDismiss());
    expect(screen.queryByTestId('overlay')).toBeEmptyDOMElement();
    expect(submit).not.toHaveBeenCalled();

    cue(['q2']);
    await user.click(screen.getByRole('radio', { name: 'Right' }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    await screen.findByRole('button', { name: 'Continue' });
    act(() => hook().onOverlayDismiss());
    expect(screen.queryByTestId('overlay')).toBeEmptyDOMElement();
  });

  it('opens an answered question from its marker for review and practice', async () => {
    const { user, cue, submit } = setup({ answers: { q1: right } });
    cue(['q1'], 'chosen');

    expect(screen.getByText('Prompt q1')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Correct');

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      screen.getByText("Practice: this answer isn't recorded"),
    ).toBeVisible();
    await user.click(screen.getByRole('radio', { name: 'Wrong' }));
    await user.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(screen.getByRole('status')).toHaveTextContent('Not quite');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('overlay')).toBeEmptyDOMElement();
    expect(submit).not.toHaveBeenCalled();
  });

  it('opens an unanswered question from its marker to answer', async () => {
    const { user, cue, submit } = setup();
    cue(['q2'], 'chosen');
    await user.click(screen.getByRole('radio', { name: 'Right' }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('does not ask an answered question', () => {
    const { cue } = setup({ answers: { q1: right } });
    cue(['q1']);
    expect(screen.queryByTestId('overlay')).toBeEmptyDOMElement();
  });

  it('keeps the card open with a note on updated, and refetches', async () => {
    const submit = vi.fn().mockRejectedValue({ kind: 'updated' });
    const { user, cue, onChanged } = setup({ submit });
    cue(['q1']);
    await user.click(screen.getByRole('radio', { name: 'Right' }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'This question was updated',
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Prompt q1')).toBeVisible();
  });

  it('clears the overlay on removed', async () => {
    const submit = vi.fn().mockRejectedValue({ kind: 'removed' });
    const { user, cue, onChanged } = setup({ submit });
    cue(['q1']);
    await user.click(screen.getByRole('radio', { name: 'Right' }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));

    await waitFor(() =>
      expect(screen.queryByTestId('overlay')).toBeEmptyDOMElement(),
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('keeps the choice with a retry on failed', async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce({ kind: 'failed' })
      .mockResolvedValueOnce(right);
    const { user, cue } = setup({ submit });
    cue(['q1']);
    await user.click(screen.getByRole('radio', { name: 'Right' }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save");
    expect(screen.getByRole('radio', { name: 'Right' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Correct'),
    );
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('asks an end check in order, then summarises', async () => {
    const questions = [question('e1', null), question('e2', null)];
    const submit = vi
      .fn()
      .mockResolvedValueOnce(right)
      .mockResolvedValueOnce({ ...right, optionIds: ['a'], correct: false });
    const { user, cue } = setup({ questions, submit });
    cue(['e1', 'e2'], 'ended');

    expect(
      screen.getByRole('heading', { name: 'Question 1 of 2' }),
    ).toBeVisible();
    await user.click(screen.getByRole('radio', { name: 'Right' }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(
      screen.getByRole('heading', { name: 'Question 2 of 2' }),
    ).toBeVisible();
    await user.click(screen.getByRole('radio', { name: 'Wrong' }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(
      screen.getByRole('heading', { name: '1 of 2 correct' }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('overlay')).toBeEmptyDOMElement();
  });

  it('ignores cues while a question is open', () => {
    const { cue } = setup();
    cue(['q1']);
    cue(['q2']);
    expect(screen.getByText('Prompt q1')).toBeVisible();
    expect(screen.queryByText('Prompt q2')).toBeNull();
  });
});
