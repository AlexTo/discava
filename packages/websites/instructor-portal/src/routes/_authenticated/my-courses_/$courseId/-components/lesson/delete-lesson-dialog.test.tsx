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
import { DeleteLessonDialog } from './delete-lesson-dialog';

const COURSE_ID = 'course-1';
const MODULE_ID = 'm1';
const LESSON_ID = 'l1';

const renderDialog = (
  props: Partial<Parameters<typeof DeleteLessonDialog>[0]> = {},
  handlers = {},
) =>
  renderWithInstructorApi(
    <DeleteLessonDialog
      courseId={COURSE_ID}
      moduleId={MODULE_ID}
      lessonId={LESSON_ID}
      title="Welcome"
      archive={false}
      trigger={<button type="button">Remove lesson</button>}
      {...props}
    />,
    { handlers },
  );

describe('DeleteLessonDialog', () => {
  describe('in a draft course (delete)', () => {
    it('warns that this cannot be undone, and Cancel deletes nothing', async () => {
      const { calls, user } = renderDialog();

      await user.click(screen.getByRole('button', { name: 'Remove lesson' }));
      expect(screen.getByRole('alertdialog')).toHaveTextContent(
        'Are you sure you want to delete "Welcome"? This can\'t be undone.',
      );
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(calls).toEqual([]);
    });

    it('deletes the lesson, closes, and refreshes the course view', async () => {
      const { calls, queryClient, optionsProxy, user } = renderDialog(
        {},
        { 'lesson.delete': () => undefined },
      );
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

      await user.click(screen.getByRole('button', { name: 'Remove lesson' }));
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'Delete lesson',
        }),
      );

      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
      );
      expect(calls).toEqual([
        {
          path: 'lesson.delete',
          input: {
            courseId: COURSE_ID,
            moduleId: MODULE_ID,
            lessonId: LESSON_ID,
          },
        },
      ]);
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: optionsProxy.course.view.queryKey({ courseId: COURSE_ID }),
      });
    });

    it('shows the error when deleting fails, and the dialog stays open', async () => {
      const { user } = renderDialog(
        {},
        {
          'lesson.delete': () => {
            throw new ApiError('CONFLICT', 'The lesson was modified');
          },
        },
      );

      await user.click(screen.getByRole('button', { name: 'Remove lesson' }));
      await user.click(screen.getByRole('button', { name: 'Delete lesson' }));

      expect(
        await screen.findByText("Couldn't delete the lesson"),
      ).toBeInTheDocument();
      expect(screen.getByText('The lesson was modified')).toBeInTheDocument();
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });
  });

  describe('outside a draft course (archive)', () => {
    it('explains that students keep their progress, warns if they used it, and archives on confirm', async () => {
      const { calls, user } = renderDialog(
        { archive: true, usedItems: 2 },
        { 'lesson.delete': () => undefined },
      );

      await user.click(screen.getByRole('button', { name: 'Remove lesson' }));
      const dialog = screen.getByRole('alertdialog');
      expect(dialog).toHaveTextContent(
        'Students will no longer see "Welcome" or its content',
      );
      expect(dialog).toHaveTextContent('Students have used 2 items in it');

      await user.click(
        within(dialog).getByRole('button', { name: 'Archive lesson' }),
      );

      await waitFor(() =>
        expect(calls).toEqual([
          {
            path: 'lesson.delete',
            input: {
              courseId: COURSE_ID,
              moduleId: MODULE_ID,
              lessonId: LESSON_ID,
            },
          },
        ]),
      );
    });

    it("doesn't warn about student activity when there is none", async () => {
      const { user } = renderDialog({ archive: true, usedItems: 0 });

      await user.click(screen.getByRole('button', { name: 'Remove lesson' }));

      expect(screen.getByRole('alertdialog')).not.toHaveTextContent(
        'Students have used',
      );
    });
  });
});
