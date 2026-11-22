/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LessonDropOff, type LessonFigures } from './lesson-drop-off';

const lesson = (id: string, share: number | null): LessonFigures => ({
  lessonId: id,
  title: `Lesson ${id}`,
  started: share === null ? 0 : 2,
  completed: share === null ? 0 : 1,
  completionShare: share,
});

const badged = () =>
  screen
    .queryAllByText('Lowest completion')
    .map((badge) => badge.closest('li')?.textContent ?? '');

describe('LessonDropOff', () => {
  it('marks no lesson when every share is the same', () => {
    render(<LessonDropOff lessons={[lesson('a', 100), lesson('b', 100)]} />);
    expect(badged()).toEqual([]);
  });

  it('marks every lesson tied at the lowest share below another', () => {
    render(
      <LessonDropOff
        lessons={[lesson('a', 100), lesson('b', 50), lesson('c', 50)]}
      />,
    );
    const marked = badged();
    expect(marked).toHaveLength(2);
    expect(marked[0]).toContain('Lesson b');
    expect(marked[1]).toContain('Lesson c');
  });

  it('marks nothing with only one lesson that has a share', () => {
    render(<LessonDropOff lessons={[lesson('a', 100), lesson('b', null)]} />);
    expect(badged()).toEqual([]);
  });

  it('names the modules with video and no questions', () => {
    render(
      <LessonDropOff
        lessons={[lesson('a', 100)]}
        modulesWithoutQuestions={[
          { moduleId: 'm1', title: 'Intro' },
          { moduleId: 'm2', title: 'Basics' },
        ]}
      />,
    );
    expect(
      screen.getByText(
        /These modules have video and no questions: Intro, Basics\. Learners remember more when a video asks them something\./,
      ),
    ).toBeInTheDocument();
  });

  it('shows no note when every module has questions', () => {
    render(
      <LessonDropOff
        lessons={[lesson('a', 100)]}
        modulesWithoutQuestions={[]}
      />,
    );
    expect(screen.queryByText(/no questions/)).not.toBeInTheDocument();
  });

  it('wraps long titles and shows the counts without hover', () => {
    const long = 'x'.repeat(70);
    render(<LessonDropOff lessons={[{ ...lesson('a', 50), title: long }]} />);
    const title = screen.getByText(long);
    expect(title).toHaveClass('break-words');
    expect(title).not.toHaveClass('truncate');
    expect(screen.getByText('2 started, 1 completed')).not.toHaveClass(
      'opacity-0',
    );
    expect(screen.getByRole('listitem')).not.toHaveAttribute('tabindex');
  });
});
