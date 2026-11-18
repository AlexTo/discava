/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../../test/render-with-instructor-api';
import { DeleteAnnouncementDialog } from './delete-announcement-dialog';

const renderDialog = (handlers = {}) =>
  renderWithInstructorApi(
    <DeleteAnnouncementDialog
      courseId="course-1"
      announcementId="a1"
      title="Welcome"
      trigger={<button type="button">Delete</button>}
    />,
    { handlers },
  );

const confirm = async (user: ReturnType<typeof renderDialog>['user']) => {
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete announcement',
    }),
  );
};

describe('DeleteAnnouncementDialog', () => {
  it('names the announcement and says students keep their notification', async () => {
    const { calls, user } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('"Welcome"');
    expect(dialog).toHaveTextContent(
      'Students keep the notification they already received.',
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls).toEqual([]);
  });

  it('deletes and closes', async () => {
    const { calls, user } = renderDialog({
      'announcement.delete': () => ({ announcementId: 'a1' }),
    });
    await confirm(user);
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    expect(calls[0]).toEqual({
      path: 'announcement.delete',
      input: { courseId: 'course-1', announcementId: 'a1' },
    });
  });

  it('treats NOT_FOUND as already deleted', async () => {
    const { user } = renderDialog({
      'announcement.delete': () => {
        throw new ApiError('NOT_FOUND', 'Announcement not found');
      },
    });
    await confirm(user);
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
  });

  it('keeps the dialog open and shows other errors', async () => {
    const { user } = renderDialog({
      'announcement.delete': () => {
        throw new ApiError('FORBIDDEN', 'Not allowed');
      },
    });
    await confirm(user);
    expect(await screen.findByText('Not allowed')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
