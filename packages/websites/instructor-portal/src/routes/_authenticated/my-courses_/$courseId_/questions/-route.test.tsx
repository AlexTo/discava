/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  lessonsView,
  renderQuestions,
} from '../../../../../test/render-questions';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, {
    // A real Link needs a router; render the target it would link to.
    Link: ({
      to,
      params,
      children,
      ...props
    }: {
      to: string;
      params: Record<string, string>;
      children: React.ReactNode;
    } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a href={to.replace('$courseId', params.courseId)} {...props}>
        {children}
      </a>
    ),
  });
});

const { Route } = await import('./route');
const RouteComponent = Route.options.component!;

beforeEach(() => {
  vi.spyOn(Route, 'useParams').mockReturnValue({ courseId: 'c1' });
});

describe('Questions route', () => {
  it('shows the three tabs, with Unanswered first, and a link back', async () => {
    const { user } = renderQuestions(<RouteComponent />, {
      instructor: {
        'discussion.unanswered': () => ({ items: [] }),
        'discussion.reported': () => ({ items: [] }),
        'course.view': () => lessonsView([]),
      },
    });

    expect(screen.getByRole('heading', { name: 'Questions' })).toBeVisible();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Unanswered',
      'Reported',
      'By lesson',
    ]);
    expect(screen.getByRole('tab', { name: 'Unanswered' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      await screen.findByText('All questions are answered.'),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Back to course' }),
    ).toHaveAttribute('href', '/my-courses/c1');

    await user.click(screen.getByRole('tab', { name: 'Reported' }));
    expect(await screen.findByText('No reported posts.')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'By lesson' }));
    expect(await screen.findByLabelText('Lesson')).toBeVisible();
  });
});
