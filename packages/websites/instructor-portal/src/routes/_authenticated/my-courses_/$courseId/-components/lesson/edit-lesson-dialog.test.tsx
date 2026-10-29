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
import { EditLessonDialog } from './edit-lesson-dialog';

const COURSE_ID = 'course-1';
const MODULE_ID = 'm1';
const LESSON_ID = 'l1';

const renderDialog = (handlers = {}) =>
  renderWithInstructorApi(
    <EditLessonDialog
      courseId={COURSE_ID}
      moduleId={MODULE_ID}
      lessonId={LESSON_ID}
      title="Welcome"
      description="What students will do"
      trigger={<button type="button">Edit lesson</button>}
    />,
    { handlers },
  );

describe('EditLessonDialog', () => {
  it('opens pre-filled with the current title and description, and Cancel calls nothing', async () => {
    const { calls, user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Edit lesson' }));
    expect(screen.getByLabelText('Lesson title')).toHaveValue('Welcome');
    expect(screen.getByLabelText('Description')).toHaveValue(
      'What students will do',
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('saves the trimmed title and description, closes, and refreshes the course view', async () => {
    const { calls, queryClient, optionsProxy, user } = renderDialog({
      'lesson.update': () => ({ lessonId: LESSON_ID }),
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(screen.getByRole('button', { name: 'Edit lesson' }));
    await user.clear(screen.getByLabelText('Lesson title'));
    await user.type(screen.getByLabelText('Lesson title'), '  Intro  ');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(calls).toEqual([
      {
        path: 'lesson.update',
        input: {
          courseId: COURSE_ID,
          moduleId: MODULE_ID,
          lessonId: LESSON_ID,
          title: 'Intro',
          description: 'What students will do',
        },
      },
    ]);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: optionsProxy.course.view.queryKey({ courseId: COURSE_ID }),
    });
  });

  it('requires a title and disables Save changes until the error clears', async () => {
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Edit lesson' }));
    await user.clear(screen.getByLabelText('Lesson title'));

    expect(screen.getByText('Lesson title is required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('shows a refusal from the API inside the dialog, which stays open', async () => {
    const { user } = renderDialog({
      'lesson.update': () => {
        throw new ApiError('BAD_REQUEST', 'A lesson with this title exists');
      },
    });

    await user.click(screen.getByRole('button', { name: 'Edit lesson' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const dialog = screen.getByRole('dialog');
    await waitFor(() =>
      expect(dialog).toHaveTextContent("Couldn't update the lesson"),
    );
    expect(dialog).toHaveTextContent('A lesson with this title exists');
  });
});
