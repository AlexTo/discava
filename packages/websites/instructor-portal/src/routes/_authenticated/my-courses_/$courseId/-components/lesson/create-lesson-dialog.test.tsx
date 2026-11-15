/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../../test/render-with-instructor-api';
import { CreateLessonDialog } from './create-lesson-dialog';

const COURSE_ID = 'course-1';
const MODULE_ID = 'm1';

const renderDialog = (handlers = {}) =>
  renderWithInstructorApi(
    <CreateLessonDialog
      courseId={COURSE_ID}
      moduleId={MODULE_ID}
      trigger={<button type="button">New lesson</button>}
    />,
    { handlers },
  );

describe('CreateLessonDialog', () => {
  it('Cancel closes the dialog and calls nothing', async () => {
    const { calls, user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'New lesson' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('requires a title, and disables Create lesson until the error clears', async () => {
    const { calls, user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'New lesson' }));
    await user.type(screen.getByLabelText('Lesson title'), 'x');
    await user.clear(screen.getByLabelText('Lesson title'));

    expect(screen.getByText('Lesson title is required')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create lesson' }),
    ).toBeDisabled();
    expect(calls).toEqual([]);
  });

  it('creates the lesson in the module with the trimmed title and description, closes, and refreshes the course view', async () => {
    const { calls, queryClient, optionsProxy, user } = renderDialog({
      'lesson.create': () => ({ lessonId: 'l1' }),
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(screen.getByRole('button', { name: 'New lesson' }));
    await user.type(screen.getByLabelText('Lesson title'), '  Welcome  ');
    await user.type(
      screen.getByLabelText('Description'),
      'What students will do',
    );
    await user.click(screen.getByRole('button', { name: 'Create lesson' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(calls).toEqual([
      {
        path: 'lesson.create',
        input: {
          courseId: COURSE_ID,
          moduleId: MODULE_ID,
          title: 'Welcome',
          description: 'What students will do',
        },
      },
    ]);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: optionsProxy.course.view.queryKey({ courseId: COURSE_ID }),
    });
  });

  it('shows a refusal from the API inside the dialog, which stays open', async () => {
    const { user } = renderDialog({
      'lesson.create': () => {
        throw new ApiError('BAD_REQUEST', 'A lesson with this title exists');
      },
    });

    await user.click(screen.getByRole('button', { name: 'New lesson' }));
    await user.type(screen.getByLabelText('Lesson title'), 'Welcome');
    await user.click(screen.getByRole('button', { name: 'Create lesson' }));

    const dialog = screen.getByRole('dialog');
    await waitFor(() =>
      expect(dialog).toHaveTextContent("Couldn't create the lesson"),
    );
    expect(dialog).toHaveTextContent('A lesson with this title exists');
  });
});
