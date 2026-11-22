/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActivationCard } from './activation-card';

const totals = (
  overrides: Partial<Parameters<typeof ActivationCard>[0]['totals']> = {},
) => ({
  enrolments: 3,
  activated: 1,
  activationRate: 33,
  promptAnswered: 2,
  promptDismissed: 1,
  ...overrides,
});

// A 30-day series with the given figures on its last two days.
const series = (days: [number, number][]) =>
  Array.from({ length: 30 }, (_, i) => {
    const [enrolments, activated] = days[i - (30 - days.length)] ?? [0, 0];
    return {
      date: `2026-11-${String(i + 1).padStart(2, '0')}`,
      enrolments,
      activated,
    };
  });

describe('ActivationCard', () => {
  it('says how many enrolled learners have started, all time', () => {
    render(<ActivationCard totals={totals()} daily={series([])} days={30} />);
    expect(
      screen.getByText('1 of 3 enrolled learners have started (33%)'),
    ).toBeInTheDocument();
  });

  it('says No data with no enrolments, all time and in range', () => {
    render(
      <ActivationCard
        totals={totals({ enrolments: 0, activated: 0, activationRate: null })}
        daily={series([])}
        days={30}
      />,
    );
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.getByText('Last 30 days: No data')).toBeInTheDocument();
  });

  it('sums the selected range from the daily series', () => {
    render(
      <ActivationCard
        totals={totals({ enrolments: 10, activated: 6, activationRate: 60 })}
        daily={series([
          [2, 1],
          [3, 2],
        ])}
        days={30}
      />,
    );
    expect(
      screen.getByText(
        'Last 30 days: 3 of 5 enrolled learners have started (60%)',
      ),
    ).toBeInTheDocument();
  });

  it('says No data in range when nobody enrolled in it', () => {
    render(<ActivationCard totals={totals()} daily={series([])} days={90} />);
    expect(screen.getByText('Last 90 days: No data')).toBeInTheDocument();
  });

  it('shows the prompt counts and the note', () => {
    render(<ActivationCard totals={totals()} daily={series([])} days={30} />);
    expect(
      screen.getByText('2 answered the first-lesson prompt, 1 dismissed it'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Started means completed an item or submitted a quiz attempt. Recent learners may still start, so these are figures so far.',
      ),
    ).toBeInTheDocument();
  });
});
