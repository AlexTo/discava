/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ResultQuestions } from './quiz-result-questions';

afterEach(cleanup);

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

describe('ResultQuestions', () => {
  it('keeps the tick from shrinking beside a long option', () => {
    const long = 'A very long option. '.repeat(10).trim();
    render(
      <ResultQuestions
        questions={[
          {
            questionId: 'q1',
            kind: 'single',
            prompt: doc('Pick'),
            options: [
              { optionId: 'a', text: long },
              { optionId: 'b', text: 'Short' },
            ],
          },
        ]}
        attempt={{
          answers: { q1: ['a'] },
          correctQuestionIds: ['q1'],
          scorePercent: 100,
          passed: true,
          submittedAt: '2026-10-21T00:00:00.000Z',
        }}
        reveal={{ q1: { correctOptionIds: ['a'] } }}
      />,
    );

    const row = screen.getByText(long).closest('li');
    expect(row?.querySelector('svg')).toHaveClass('shrink-0');
    expect(row).toHaveClass('items-start');
    expect(screen.getByText('(your answer)')).toHaveClass(
      'shrink-0',
      'whitespace-nowrap',
    );
  });
});
