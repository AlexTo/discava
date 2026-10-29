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
import { EditModuleDialog } from './edit-module-dialog';

const COURSE_ID = 'course-1';
const MODULE_ID = 'm1';

const renderDialog = (handlers = {}) =>
  renderWithInstructorApi(
    <EditModuleDialog
      courseId={COURSE_ID}
      moduleId={MODULE_ID}
      title="Intro"
      description="What this module covers"
      trigger={<button type="button">Edit module</button>}
    />,
    { handlers },
  );

describe('EditModuleDialog', () => {
  it('opens pre-filled with the current title and description, and Cancel calls nothing', async () => {
    const { calls, user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Edit module' }));
    expect(screen.getByLabelText('Module title')).toHaveValue('Intro');
    expect(screen.getByLabelText('Description')).toHaveValue(
      'What this module covers',
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('saves the trimmed title and description, closes, and refreshes the course view', async () => {
    const { calls, queryClient, optionsProxy, user } = renderDialog({
      'module.update': () => ({ moduleId: MODULE_ID }),
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(screen.getByRole('button', { name: 'Edit module' }));
    await user.clear(screen.getByLabelText('Module title'));
    await user.type(
      screen.getByLabelText('Module title'),
      '  Getting started  ',
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(calls).toEqual([
      {
        path: 'module.update',
        input: {
          courseId: COURSE_ID,
          moduleId: MODULE_ID,
          title: 'Getting started',
          description: 'What this module covers',
        },
      },
    ]);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: optionsProxy.course.view.queryKey({ courseId: COURSE_ID }),
    });
  });

  it('requires a title and disables Save changes until the error clears', async () => {
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Edit module' }));
    await user.clear(screen.getByLabelText('Module title'));

    expect(screen.getByText('Module title is required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('shows a refusal from the API inside the dialog, which stays open', async () => {
    const { user } = renderDialog({
      'module.update': () => {
        throw new ApiError('BAD_REQUEST', 'A module with this title exists');
      },
    });

    await user.click(screen.getByRole('button', { name: 'Edit module' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const dialog = screen.getByRole('dialog');
    await waitFor(() =>
      expect(dialog).toHaveTextContent("Couldn't update the module"),
    );
    expect(dialog).toHaveTextContent('A module with this title exists');
  });
});
