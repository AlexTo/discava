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
    useLocation: () => ({ pathname: '/my-courses/c1/questions' }),
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

type Search = { tab: string; lesson?: string };
const navigate = vi.fn();
const showing = (search: Search) =>
  vi.spyOn(Route, 'useSearch').mockReturnValue(search as never);
const validate = Route.options.validateSearch as (
  search: Record<string, unknown>,
) => Search;

beforeEach(() => {
  navigate.mockReset();
  vi.spyOn(Route, 'useParams').mockReturnValue({ courseId: 'c1' });
  vi.spyOn(Route, 'useNavigate').mockReturnValue(navigate as never);
  showing({ tab: 'unanswered' });
});

const queues = {
  'discussion.unanswered': () => ({ items: [] }),
  'discussion.reported': () => ({ items: [] }),
  'course.view': () => lessonsView([{ lessonId: 'l1' }]),
};

describe('Questions route', () => {
  it('validates the tab and lesson from the address', () => {
    expect(validate({})).toEqual({ tab: 'unanswered' });
    expect(validate({ tab: 'reported' })).toEqual({ tab: 'reported' });
    expect(validate({ tab: 'nope', lesson: 'l1' })).toEqual({
      tab: 'unanswered',
      lesson: 'l1',
    });
    expect(validate({ tab: 'by-lesson', lesson: 5 })).toEqual({
      tab: 'by-lesson',
    });
  });

  it('opens on the tab the address names', async () => {
    showing({ tab: 'reported' });
    renderQuestions(<RouteComponent />, { instructor: queues });

    expect(screen.getByRole('tab', { name: 'Reported' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByText('No reported posts.')).toBeVisible();
  });

  it('writes the tab to the address when one is chosen', async () => {
    const { user } = renderQuestions(<RouteComponent />, {
      instructor: queues,
    });

    await user.click(screen.getByRole('tab', { name: 'Reported' }));

    expect(navigate).toHaveBeenCalledWith({ search: { tab: 'reported' } });
  });

  it('shows the lesson the address names on By lesson', async () => {
    showing({ tab: 'by-lesson', lesson: 'l1' });
    renderQuestions(<RouteComponent />, {
      instructor: queues,
      core: { 'discussion.listQuestions': () => ({ items: [] }) },
    });

    expect(await screen.findByLabelText('Lesson')).toHaveValue('l1');
  });

  it('shows By lesson with nothing chosen for a lesson not in the course', async () => {
    showing({ tab: 'by-lesson', lesson: 'gone' });
    renderQuestions(<RouteComponent />, { instructor: queues });

    expect(screen.getByRole('tab', { name: 'By lesson' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByLabelText('Lesson')).toHaveValue('');
  });

  it('writes the lesson to the address when one is chosen', async () => {
    showing({ tab: 'by-lesson' });
    const { user } = renderQuestions(<RouteComponent />, {
      instructor: queues,
      core: { 'discussion.listQuestions': () => ({ items: [] }) },
    });

    await user.selectOptions(await screen.findByLabelText('Lesson'), 'l1');

    const { search } = navigate.mock.calls[0]![0] as {
      search: (prev: Search) => Search;
    };
    expect(search({ tab: 'by-lesson' })).toEqual({
      tab: 'by-lesson',
      lesson: 'l1',
    });
  });

  it('shows the three tabs, with Unanswered first, and a link back', async () => {
    renderQuestions(<RouteComponent />, {
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
  });
});
