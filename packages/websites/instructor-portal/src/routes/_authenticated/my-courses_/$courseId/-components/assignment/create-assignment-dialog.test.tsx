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
import { CreateAssignmentDialog } from './create-assignment-dialog';

const COURSE_ID = 'course-1';
const MODULE_ID = 'm1';

const renderDialog = (handlers = {}) =>
  renderWithInstructorApi(
    <CreateAssignmentDialog
      courseId={COURSE_ID}
      moduleId={MODULE_ID}
      trigger={<button type="button">New assignment</button>}
    />,
    { handlers },
  );

describe('CreateAssignmentDialog', () => {
  it('offers Upload and Quiz, with Upload chosen', async () => {
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'New assignment' }));

    expect(screen.getByRole('radio', { name: /Upload/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Quiz/ })).not.toBeChecked();
    expect(screen.getByLabelText('Assignment title')).toBeInTheDocument();
  });

  it('names what is missing, and calls nothing, when an upload assignment is incomplete', async () => {
    const { calls, user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'New assignment' }));
    await user.click(screen.getByRole('button', { name: 'Create assignment' }));

    expect(screen.getByText('Assignment title is required')).toBeVisible();
    expect(
      screen.getByText('Write the instructions students will follow'),
    ).toBeVisible();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it.each(['0', '1001', '2.5'])('rejects %s max points', async (points) => {
    const { calls, user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'New assignment' }));
    await user.type(screen.getByLabelText('Assignment title'), 'Essay');
    await user.type(screen.getByLabelText('Instructions'), 'Write it');
    await user.clear(screen.getByLabelText('Max points'));
    await user.type(screen.getByLabelText('Max points'), points);
    await user.click(screen.getByRole('button', { name: 'Create assignment' }));

    expect(
      screen.getByText('Max points is a whole number from 1 to 1000'),
    ).toBeVisible();
    expect(calls).toEqual([]);
  });

  it('creates the upload assignment in the module with its due date, closes, and refreshes the course view', async () => {
    const { calls, queryClient, optionsProxy, user } = renderDialog({
      'lesson.createUploadAssignment': () => ({ lessonId: 'l1' }),
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(screen.getByRole('button', { name: 'New assignment' }));
    await user.type(screen.getByLabelText('Assignment title'), '  Essay  ');
    await user.type(screen.getByLabelText('Instructions'), 'Write about it');
    await user.clear(screen.getByLabelText('Max points'));
    await user.type(screen.getByLabelText('Max points'), '25');
    await user.type(
      screen.getByLabelText('Due date (optional)'),
      '2030-01-01T09:30',
    );
    await user.click(screen.getByRole('button', { name: 'Create assignment' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('lesson.createUploadAssignment');
    expect(calls[0].input).toMatchObject({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      title: 'Essay',
      maxPoints: 25,
      dueAt: new Date(2030, 0, 1, 9, 30).toISOString(),
    });
    expect(JSON.parse((calls[0].input as { body: string }).body)).toMatchObject(
      {
        type: 'doc',
        content: [{ content: [{ text: 'Write about it' }] }],
      },
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: optionsProxy.course.view.queryKey({ courseId: COURSE_ID }),
    });
  });

  it('leaves the due date out when none is set', async () => {
    const { calls, user } = renderDialog({
      'lesson.createUploadAssignment': () => ({ lessonId: 'l1' }),
    });

    await user.click(screen.getByRole('button', { name: 'New assignment' }));
    await user.type(screen.getByLabelText('Assignment title'), 'Essay');
    await user.type(screen.getByLabelText('Instructions'), 'Write it');
    await user.click(screen.getByRole('button', { name: 'Create assignment' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].input).toMatchObject({ maxPoints: 10 });
  });

  it("shows the API's refusal inside the dialog, which stays open", async () => {
    const { user } = renderDialog({
      'lesson.createUploadAssignment': () => {
        throw new ApiError('BAD_REQUEST', 'Restore the module first');
      },
    });

    await user.click(screen.getByRole('button', { name: 'New assignment' }));
    await user.type(screen.getByLabelText('Assignment title'), 'Essay');
    await user.type(screen.getByLabelText('Instructions'), 'Write it');
    await user.click(screen.getByRole('button', { name: 'Create assignment' }));

    const dialog = screen.getByRole('dialog');
    await waitFor(() =>
      expect(dialog).toHaveTextContent("Couldn't create the assignment"),
    );
    expect(dialog).toHaveTextContent('Restore the module first');
  });

  it('swaps the upload fields for the quiz builder when Quiz is chosen', async () => {
    const { calls, user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'New assignment' }));
    await user.click(screen.getByRole('radio', { name: /Quiz/ }));

    expect(screen.queryByLabelText('Max points')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save quiz/ })).toBeVisible();

    // An empty quiz isn't saved.
    await user.click(screen.getByRole('button', { name: /Save quiz/ }));
    expect(calls).toEqual([]);
  });

  it('Cancel resets what was typed, and Escape asks before discarding it', async () => {
    const { user } = renderDialog();
    const open = () =>
      user.click(screen.getByRole('button', { name: 'New assignment' }));

    await open();
    await user.type(screen.getByLabelText('Assignment title'), 'Typed');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await open();
    expect(screen.getByLabelText('Assignment title')).toHaveValue('');

    await user.type(screen.getByLabelText('Assignment title'), 'Typed');
    await user.keyboard('{Escape}');
    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Assignment title')).toHaveValue('Typed');
  });

  it('asks before switching away from a quiz with changes', async () => {
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'New assignment' }));
    await user.click(screen.getByRole('radio', { name: /Quiz/ }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Quiz');
    await user.click(screen.getByRole('radio', { name: /Upload/ }));

    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('radio', { name: /Quiz/ })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: /Upload/ }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('radio', { name: /Upload/ })).toBeChecked();
  });

  it('asks on Escape with a dirty quiz, and closes at once on a clean one', async () => {
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'New assignment' }));
    await user.click(screen.getByRole('radio', { name: /Quiz/ }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New assignment' }));
    await user.click(screen.getByRole('radio', { name: /Quiz/ }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Quiz');
    await user.keyboard('{Escape}');
    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();
  });
});
