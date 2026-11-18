/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../../../../test/fake-trpc-fetch';
import {
  lessonsView,
  renderQuestions,
} from '../../../../../../test/render-questions';
import { ReportedView } from './reported-view';

const post = (extra = {}) => ({
  postId: 'r1',
  threadId: 'q1',
  kind: 'reply',
  state: 'shown',
  authorName: 'Bob K.',
  authorIsInstructor: false,
  body: 'Buy my course <b>now</b>',
  createdAt: '2026-11-17T10:00:00.000Z',
  voteCount: 0,
  mine: false,
  reportCount: 3,
  moduleId: 'm1',
  lessonId: 'l1',
  lessonTitle: 'Lesson l1',
  ...extra,
});

const ref = {
  courseId: 'c1',
  moduleId: 'm1',
  lessonId: 'l1',
  threadId: 'q1',
  postId: 'r1',
};

const render = (extra: Record<string, (input: unknown) => unknown> = {}) =>
  renderQuestions(<ReportedView courseId="c1" />, {
    instructor: {
      'course.view': () => lessonsView([{ lessonId: 'l1' }]),
      'discussion.reported': () => ({ items: [post()] }),
      ...extra,
    },
  });

describe('ReportedView', () => {
  it('shows the post, its kind, author, lesson and report count, as text', async () => {
    render();

    expect(await screen.findByText('Buy my course <b>now</b>')).toBeVisible();
    expect(screen.getByText(/Reply/)).toBeVisible();
    expect(screen.getByText(/Bob K\./)).toBeVisible();
    expect(screen.getByText(/Lesson l1/)).toBeVisible();
    expect(screen.getByText(/3 reports/)).toBeVisible();
  });

  it('names no reporter', async () => {
    const { container } = render({
      'discussion.reported': () => ({
        items: [post({ reportedBy: ['u1'], reporterName: 'Reporter R.' })],
      }),
    });
    await screen.findByText(/3 reports/);
    expect(container).not.toHaveTextContent(/Reporter R\.|reported by/i);
  });

  it('hides the post', async () => {
    const { user, calls } = render({ 'discussion.hide': () => post() });

    await user.click(await screen.findByRole('button', { name: 'Hide' }));

    expect(calls.find((c) => c.path === 'discussion.hide')?.input).toEqual(ref);
  });

  it('dismisses the reports', async () => {
    const { user, calls } = render({
      'discussion.dismissReports': () => post(),
    });

    await user.click(
      await screen.findByRole('button', { name: 'Dismiss reports' }),
    );

    expect(
      calls.find((c) => c.path === 'discussion.dismissReports')?.input,
    ).toEqual(ref);
  });

  it('deletes only after a confirmation, and refreshes the list', async () => {
    const { user, calls } = render({ 'discussion.remove': () => post() });

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(calls.some((c) => c.path === 'discussion.remove')).toBe(false);
    expect(screen.getByText('Delete this reply?')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Delete reply' }));

    expect(calls.find((c) => c.path === 'discussion.remove')?.input).toEqual(
      ref,
    );
    await screen.findByText('Buy my course <b>now</b>');
    expect(
      calls.filter((c) => c.path === 'discussion.reported').length,
    ).toBeGreaterThan(1);
  });

  it('shows the message of a failing action', async () => {
    const { user } = render({
      'discussion.hide': () => {
        throw new ApiError('NOT_FOUND', 'That post is gone');
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Hide' }));

    expect(await screen.findByText('That post is gone')).toBeVisible();
  });

  it('shows the empty state', async () => {
    render({ 'discussion.reported': () => ({ items: [] }) });
    expect(await screen.findByText('No reported posts.')).toBeVisible();
  });
});
