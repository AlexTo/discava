/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../../test/render-with-instructor-api';
import { EditAssignmentDialog } from './edit-assignment-dialog';

const body = JSON.stringify({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Old instructions' }],
    },
  ],
});
const DUE_AT = new Date(2030, 5, 7, 18, 5).toISOString();

const renderDialog = (handlers = {}, props = {}) =>
  renderWithInstructorApi(
    <EditAssignmentDialog
      courseId="course-1"
      moduleId="m1"
      lessonId="l1"
      contentItemId="ci1"
      title="Essay"
      body={body}
      maxPoints={10}
      dueAt={DUE_AT}
      trigger={<button type="button">Edit</button>}
      {...props}
    />,
    { handlers },
  );

describe('EditAssignmentDialog', () => {
  it("starts from the assignment's instructions, points and due date", async () => {
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText('Max points')).toHaveValue(10);
    expect(screen.getByLabelText('Due date (optional)')).toHaveValue(
      '2030-06-07T18:05',
    );
    expect(screen.getByText('Old instructions')).toBeInTheDocument();
    expect(screen.queryByLabelText('Assignment title')).not.toBeInTheDocument();
  });

  it('saves the new points with updateAssignment and closes', async () => {
    const { calls, user } = renderDialog({
      'contentItem.updateAssignment': () => ({ contentItemId: 'ci1' }),
    });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Max points'));
    await user.type(screen.getByLabelText('Max points'), '40');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('contentItem.updateAssignment');
    expect(calls[0].input).toMatchObject({
      courseId: 'course-1',
      moduleId: 'm1',
      lessonId: 'l1',
      contentItemId: 'ci1',
      body,
      maxPoints: 40,
      dueAt: DUE_AT,
    });
  });

  it('removes the due date by sending dueAt: null', async () => {
    const { calls, user } = renderDialog({
      'contentItem.updateAssignment': () => ({ contentItemId: 'ci1' }),
    });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Due date (optional)'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].input).toMatchObject({ dueAt: null });
  });

  it('does not save invalid points', async () => {
    const { calls, user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Max points'));
    await user.type(screen.getByLabelText('Max points'), '0');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      screen.getByText('Max points is a whole number from 1 to 1000'),
    ).toBeVisible();
    expect(calls).toEqual([]);
  });

  it("shows the API's refusal, and stays open", async () => {
    const { user } = renderDialog({
      'contentItem.updateAssignment': () => {
        throw new ApiError('BAD_REQUEST', 'The course is archived');
      },
    });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveTextContent(
        'The course is archived',
      ),
    );
  });
});
