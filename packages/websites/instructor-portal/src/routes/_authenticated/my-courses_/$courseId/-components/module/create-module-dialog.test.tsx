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
import { CreateModuleDialog } from './create-module-dialog';

const COURSE_ID = 'course-1';

const renderDialog = (handlers = {}) =>
  renderWithInstructorApi(
    <CreateModuleDialog
      courseId={COURSE_ID}
      trigger={<button type="button">New module</button>}
    />,
    { handlers },
  );

describe('CreateModuleDialog', () => {
  it('Cancel closes the dialog and calls nothing', async () => {
    const { calls, user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'New module' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('requires a title, and disables Create module until the error clears', async () => {
    const { calls, user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'New module' }));
    await user.type(screen.getByLabelText('Module title'), 'x');
    await user.clear(screen.getByLabelText('Module title'));

    expect(screen.getByText('Module title is required')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create module' }),
    ).toBeDisabled();
    expect(calls).toEqual([]);
  });

  it('creates the module with the trimmed title and description, closes, and refreshes the course view', async () => {
    const { calls, queryClient, optionsProxy, user } = renderDialog({
      'module.create': () => ({ moduleId: 'm1' }),
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(screen.getByRole('button', { name: 'New module' }));
    await user.type(
      screen.getByLabelText('Module title'),
      '  Getting started  ',
    );
    await user.type(
      screen.getByLabelText('Description'),
      'What this module covers',
    );
    await user.click(screen.getByRole('button', { name: 'Create module' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(calls).toEqual([
      {
        path: 'module.create',
        input: {
          courseId: COURSE_ID,
          title: 'Getting started',
          description: 'What this module covers',
        },
      },
    ]);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: optionsProxy.course.view.queryKey({ courseId: COURSE_ID }),
    });
  });

  it('shows a refusal from the API inside the dialog, which stays open', async () => {
    const { user } = renderDialog({
      'module.create': () => {
        throw new ApiError('BAD_REQUEST', 'A module with this title exists');
      },
    });

    await user.click(screen.getByRole('button', { name: 'New module' }));
    await user.type(screen.getByLabelText('Module title'), 'Intro');
    await user.click(screen.getByRole('button', { name: 'Create module' }));

    const dialog = screen.getByRole('dialog');
    await waitFor(() =>
      expect(dialog).toHaveTextContent("Couldn't create the module"),
    );
    expect(dialog).toHaveTextContent('A module with this title exists');
  });
});
