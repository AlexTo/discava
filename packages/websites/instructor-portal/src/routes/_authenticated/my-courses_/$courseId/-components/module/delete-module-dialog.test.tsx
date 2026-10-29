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
import { DeleteModuleDialog } from './delete-module-dialog';

const COURSE_ID = 'course-1';
const MODULE_ID = 'm1';

const renderDialog = (
  props: Partial<Parameters<typeof DeleteModuleDialog>[0]> = {},
  handlers = {},
) =>
  renderWithInstructorApi(
    <DeleteModuleDialog
      courseId={COURSE_ID}
      moduleId={MODULE_ID}
      title="Intro"
      lessonCount={0}
      archive={false}
      trigger={<button type="button">Remove module</button>}
      {...props}
    />,
    { handlers },
  );

describe('DeleteModuleDialog', () => {
  describe('in a draft course (delete)', () => {
    it('warns about the lessons inside and Cancel deletes nothing', async () => {
      const { calls, user } = renderDialog({ lessonCount: 2 });

      await user.click(screen.getByRole('button', { name: 'Remove module' }));
      expect(screen.getByRole('alertdialog')).toHaveTextContent(
        'This will also delete 2 lessons inside it',
      );
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(calls).toEqual([]);
    });

    it("doesn't mention lessons when there are none", async () => {
      const { user } = renderDialog({ lessonCount: 0 });

      await user.click(screen.getByRole('button', { name: 'Remove module' }));

      expect(screen.getByRole('alertdialog')).not.toHaveTextContent('lesson');
    });

    it('deletes the module, closes, and refreshes the course view', async () => {
      const { calls, queryClient, optionsProxy, user } = renderDialog(
        {},
        { 'module.delete': () => undefined },
      );
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

      await user.click(screen.getByRole('button', { name: 'Remove module' }));
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'Delete module',
        }),
      );

      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
      );
      expect(calls).toEqual([
        {
          path: 'module.delete',
          input: { courseId: COURSE_ID, moduleId: MODULE_ID },
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
          'module.delete': () => {
            throw new ApiError('CONFLICT', 'The module was modified');
          },
        },
      );

      await user.click(screen.getByRole('button', { name: 'Remove module' }));
      await user.click(screen.getByRole('button', { name: 'Delete module' }));

      expect(
        await screen.findByText("Couldn't delete the module"),
      ).toBeInTheDocument();
      expect(screen.getByText('The module was modified')).toBeInTheDocument();
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });
  });

  describe('outside a draft course (archive)', () => {
    it('explains that students keep their progress, warns if they used it, and archives on confirm', async () => {
      const { calls, user } = renderDialog(
        { archive: true, usedItems: 3 },
        { 'module.delete': () => undefined },
      );

      await user.click(screen.getByRole('button', { name: 'Remove module' }));
      const dialog = screen.getByRole('alertdialog');
      expect(dialog).toHaveTextContent(
        'Students will no longer see "Intro" or anything in it',
      );
      expect(dialog).toHaveTextContent('Students have used 3 items in it');

      await user.click(
        within(dialog).getByRole('button', { name: 'Archive module' }),
      );

      await waitFor(() =>
        expect(calls).toEqual([
          {
            path: 'module.delete',
            input: { courseId: COURSE_ID, moduleId: MODULE_ID },
          },
        ]),
      );
    });

    it("doesn't warn about student activity when there is none", async () => {
      const { user } = renderDialog({ archive: true, usedItems: 0 });

      await user.click(screen.getByRole('button', { name: 'Remove module' }));

      expect(screen.getByRole('alertdialog')).not.toHaveTextContent(
        'Students have used',
      );
    });
  });
});
