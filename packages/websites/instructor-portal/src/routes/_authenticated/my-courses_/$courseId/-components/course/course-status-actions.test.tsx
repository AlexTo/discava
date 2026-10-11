/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../../test/render-with-instructor-api';
import { CourseStatusActions } from './course-status-actions';

const COURSE_ID = 'course-1';
const course = (status: string) => ({
  courseId: COURSE_ID,
  title: 'Intro to DynamoDB',
  status,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
});

const renderActions = (
  status: 'draft' | 'published' | 'archived',
  handlers = {},
) =>
  renderWithInstructorApi(
    <CourseStatusActions
      courseId={COURSE_ID}
      title="Intro to DynamoDB"
      status={status}
    />,
    { handlers },
  );

describe('CourseStatusActions', () => {
  it.each([
    ['draft', true, false],
    ['published', false, false],
    ['archived', false, true],
  ] as const)(
    'for a %s course shows Publish: %s, Restore: %s',
    (status, publish, restore) => {
      renderActions(status);

      expect(screen.queryByRole('button', { name: 'Publish' }) !== null).toBe(
        publish,
      );
      expect(screen.queryByRole('button', { name: 'Restore' }) !== null).toBe(
        restore,
      );
    },
  );

  describe('Publish', () => {
    it('explains what publishing means, and Cancel publishes nothing', async () => {
      const { calls, user } = renderActions('draft');

      await user.click(screen.getByRole('button', { name: 'Publish' }));
      expect(screen.getByRole('alertdialog')).toHaveTextContent(
        'Students will be able to see "Intro to DynamoDB"',
      );
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(calls).toEqual([]);
    });

    it('publishes the course on confirm, closes, and refreshes the course view', async () => {
      const { calls, queryClient, optionsProxy, user } = renderActions(
        'draft',
        { 'course.publish': () => course('published') },
      );
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

      await user.click(screen.getByRole('button', { name: 'Publish' }));
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'Publish',
        }),
      );

      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
      );
      expect(calls).toEqual([
        { path: 'course.publish', input: { courseId: COURSE_ID } },
      ]);
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: optionsProxy.course.view.queryKey({ courseId: COURSE_ID }),
      });
    });

    it('shows a refusal from the API inside the dialog, which stays open', async () => {
      const { user } = renderActions('draft', {
        'course.publish': () => {
          throw new ApiError(
            'PRECONDITION_FAILED',
            'Add at least one visible content item before publishing the course',
          );
        },
      });

      await user.click(screen.getByRole('button', { name: 'Publish' }));
      await user.click(
        screen.getAllByRole('button', { name: 'Publish' }).at(-1)!,
      );

      const dialog = screen.getByRole('alertdialog');
      await waitFor(() =>
        expect(dialog).toHaveTextContent("Couldn't publish the course"),
      );
      expect(dialog).toHaveTextContent(
        'Add at least one visible content item before publishing the course',
      );
    });
  });

  describe('Restore', () => {
    it('restores the course and refreshes the course view', async () => {
      const { calls, queryClient, optionsProxy, user } = renderActions(
        'archived',
        { 'course.restore': () => course('published') },
      );
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

      await user.click(screen.getByRole('button', { name: 'Restore' }));

      await waitFor(() =>
        expect(calls).toEqual([
          { path: 'course.restore', input: { courseId: COURSE_ID } },
        ]),
      );
      await waitFor(() =>
        expect(invalidate).toHaveBeenCalledWith({
          queryKey: optionsProxy.course.view.queryKey({ courseId: COURSE_ID }),
        }),
      );
    });

    it('shows the error when restoring fails', async () => {
      const { user } = renderActions('archived', {
        'course.restore': () => {
          throw new ApiError(
            'CONFLICT',
            'The course was modified by another request; please retry',
          );
        },
      });

      await user.click(screen.getByRole('button', { name: 'Restore' }));

      expect(
        await screen.findByText("Couldn't restore the course"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'The course was modified by another request; please retry',
        ),
      ).toBeInTheDocument();
    });
  });
});
