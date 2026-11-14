/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../test/render-with-instructor-api';
import { CreateCourseDialog } from './create-course-dialog';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => navigate };
});

const renderDialog = (handlers = {}) =>
  renderWithInstructorApi(
    <CreateCourseDialog trigger={<button type="button">New course</button>} />,
    { handlers },
  );

describe('CreateCourseDialog', () => {
  it('Cancel closes the dialog and calls nothing', async () => {
    const { calls, user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'New course' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('requires a title and disables Save until the error clears', async () => {
    const { calls, user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'New course' }));
    await user.type(screen.getByLabelText('Course title'), 'x');
    await user.clear(screen.getByLabelText('Course title'));

    expect(screen.getByText('Course title is required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(calls).toEqual([]);
  });

  it('counts the summary characters, out of 2000', async () => {
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'New course' }));
    expect(screen.getByText('0 / 2000 characters')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Course summary'), 'Hello');
    expect(screen.getByText('5 / 2000 characters')).toBeInTheDocument();
  });

  it('creates the course with the trimmed title and summary, closes, and navigates to the new course', async () => {
    const { calls, user } = renderDialog({
      'course.create': () => ({ courseId: 'course-42' }),
    });

    await user.click(screen.getByRole('button', { name: 'New course' }));
    await user.type(
      screen.getByLabelText('Course title'),
      '  Intro to DynamoDB  ',
    );
    await user.type(
      screen.getByLabelText('Course summary'),
      '  Learn the basics  ',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(calls).toEqual([
      {
        path: 'course.create',
        input: {
          title: 'Intro to DynamoDB',
          description: 'Learn the basics',
        },
      },
    ]);
    expect(navigate).toHaveBeenCalledWith({
      to: '/my-courses/$courseId',
      params: { courseId: 'course-42' },
    });
  });

  it('omits an empty summary', async () => {
    const { calls, user } = renderDialog({
      'course.create': () => ({ courseId: 'course-42' }),
    });

    await user.click(screen.getByRole('button', { name: 'New course' }));
    await user.type(screen.getByLabelText('Course title'), 'Intro');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(calls).toEqual([
        {
          path: 'course.create',
          input: { title: 'Intro', description: undefined },
        },
      ]),
    );
  });

  it('shows a refusal from the API inside the dialog, which stays open and does not navigate', async () => {
    const { user } = renderDialog({
      'course.create': () => {
        throw new ApiError('BAD_REQUEST', 'A course with this title exists');
      },
    });

    await user.click(screen.getByRole('button', { name: 'New course' }));
    await user.type(screen.getByLabelText('Course title'), 'Intro');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const dialog = screen.getByRole('dialog');
    await waitFor(() =>
      expect(dialog).toHaveTextContent("Couldn't create the course"),
    );
    expect(dialog).toHaveTextContent('A course with this title exists');
    expect(navigate).not.toHaveBeenCalled();
  });
});
