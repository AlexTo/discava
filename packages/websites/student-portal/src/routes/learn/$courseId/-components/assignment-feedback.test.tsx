/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  AssignmentFeedback,
  AssignmentFeedbackRound,
  type FeedbackRound,
} from './assignment-feedback';

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const round = (overrides: Partial<FeedbackRound> = {}): FeedbackRound => ({
  kind: 'returned',
  feedback: doc('Well argued'),
  points: 17,
  pointsOutOf: 20,
  version: 1,
  givenAt: '2026-11-15T09:00:00.000Z',
  ...overrides,
});

describe('AssignmentFeedbackRound', () => {
  it('shows a return with its points, feedback, version and date', () => {
    render(<AssignmentFeedbackRound round={round()} />);

    expect(screen.getByText('Returned')).toBeVisible();
    expect(screen.getByText('17 / 20')).toBeVisible();
    expect(screen.getByText('Well argued')).toBeVisible();
    expect(screen.getByText('Version 1')).toBeVisible();
    expect(
      screen.getByText(new Date('2026-11-15T09:00:00.000Z').toLocaleString()),
    ).toBeVisible();
  });

  it('labels a resubmission request, which carries no points', () => {
    render(
      <AssignmentFeedbackRound
        round={round({
          kind: 'resubmission_requested',
          feedback: doc('Cite your sources'),
          points: undefined,
          pointsOutOf: undefined,
        })}
      />,
    );

    expect(screen.getByText('Resubmission requested')).toBeVisible();
    expect(screen.getByText('Cite your sources')).toBeVisible();
    expect(screen.queryByText(/\d+ \/ \d+/)).not.toBeInTheDocument();
  });

  it('labels an amended grade', () => {
    render(
      <AssignmentFeedbackRound
        round={round({ kind: 'amended', points: 19 })}
      />,
    );

    expect(screen.getByText('Grade updated')).toBeVisible();
    expect(screen.getByText('19 / 20')).toBeVisible();
  });

  it('shows a round without feedback text', () => {
    render(<AssignmentFeedbackRound round={round({ feedback: undefined })} />);

    expect(screen.getByText('Returned')).toBeVisible();
    expect(screen.getByText('17 / 20')).toBeVisible();
  });
});

describe('AssignmentFeedback', () => {
  const rounds = [
    round({ kind: 'amended', feedback: doc('Newer note'), version: 2 }),
    round({ feedback: doc('Older note'), version: 1 }),
  ];

  it('renders nothing without earlier rounds', () => {
    const { container } = render(<AssignmentFeedback rounds={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps earlier feedback collapsed until opened, newest first', async () => {
    const user = userEvent.setup();
    render(<AssignmentFeedback rounds={rounds} />);

    const trigger = screen.getByRole('button', { name: /Earlier feedback/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Newer note')).not.toBeInTheDocument();

    await user.click(trigger);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Newer note')).toBeVisible();
    expect(within(items[1]).getByText('Older note')).toBeVisible();
  });
});
