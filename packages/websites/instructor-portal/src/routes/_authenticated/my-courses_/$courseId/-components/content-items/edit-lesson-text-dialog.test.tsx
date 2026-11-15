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
import {
  EditLessonTextDialog,
  RemoveLessonTextButton,
} from './edit-lesson-text-dialog';

const COURSE_ID = 'course-1';
const MODULE_ID = 'm1';
const LESSON_ID = 'l1';
const CONTENT_ITEM_ID = 'ci1';

const renderAddDialog = (handlers = {}) =>
  renderWithInstructorApi(
    <EditLessonTextDialog
      courseId={COURSE_ID}
      moduleId={MODULE_ID}
      lessonId={LESSON_ID}
      trigger={<button type="button">Add text</button>}
    />,
    { handlers },
  );

const existingBody = JSON.stringify({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Existing body' }] },
  ],
});

const renderEditDialog = (handlers = {}) =>
  renderWithInstructorApi(
    <EditLessonTextDialog
      courseId={COURSE_ID}
      moduleId={MODULE_ID}
      lessonId={LESSON_ID}
      contentItemId={CONTENT_ITEM_ID}
      title="Key concepts"
      description="Some notes"
      body={existingBody}
      trigger={<button type="button">Edit text</button>}
    />,
    { handlers },
  );

describe('EditLessonTextDialog', () => {
  describe('adding a new text item', () => {
    it('titles the dialog "Add text" and disables Save until there is a title and a body', async () => {
      const { user } = renderAddDialog();

      await user.click(screen.getByRole('button', { name: 'Add text' }));
      expect(screen.getByRole('dialog')).toHaveTextContent('Add text');
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

      await user.type(screen.getByLabelText('Title'), 'Key concepts');
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

      await user.type(screen.getByLabelText('Body'), 'Some body text');
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    it('creates the text item, closes, and refreshes the course view', async () => {
      const { calls, queryClient, optionsProxy, user } = renderAddDialog({
        'contentItem.createText': () => ({ contentItemId: CONTENT_ITEM_ID }),
      });
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

      await user.click(screen.getByRole('button', { name: 'Add text' }));
      await user.type(screen.getByLabelText('Title'), 'Key concepts');
      await user.type(screen.getByLabelText('Description'), 'Some notes');
      await user.type(screen.getByLabelText('Body'), 'Some body text');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(calls).toHaveLength(1);
      expect(calls[0].path).toBe('contentItem.createText');
      expect(calls[0].input).toMatchObject({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        title: 'Key concepts',
        description: 'Some notes',
      });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: optionsProxy.course.view.queryKey({ courseId: COURSE_ID }),
      });
    });

    it('shows a refusal from the API, and the dialog stays open', async () => {
      const { user } = renderAddDialog({
        'contentItem.createText': () => {
          throw new ApiError('BAD_REQUEST', "Title can't be blank");
        },
      });

      await user.click(screen.getByRole('button', { name: 'Add text' }));
      await user.type(screen.getByLabelText('Title'), 'Key concepts');
      await user.type(screen.getByLabelText('Body'), 'Some body text');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      const dialog = await screen.findByText("Couldn't save the text");
      expect(dialog).toBeInTheDocument();
      expect(screen.getByText("Title can't be blank")).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('editing an existing text item', () => {
    it('opens pre-filled with the current title, description and body, titled "Edit text"', async () => {
      const { user } = renderEditDialog();

      await user.click(screen.getByRole('button', { name: 'Edit text' }));

      expect(screen.getByRole('dialog')).toHaveTextContent('Edit text');
      expect(screen.getByLabelText('Title')).toHaveValue('Key concepts');
      expect(screen.getByLabelText('Description')).toHaveValue('Some notes');
      expect(screen.getByLabelText('Body')).toHaveTextContent('Existing body');
    });

    it('Cancel calls nothing', async () => {
      const { calls, user } = renderEditDialog();

      await user.click(screen.getByRole('button', { name: 'Edit text' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(calls).toEqual([]);
    });

    it('saves changes, closes, and refreshes the course view', async () => {
      const { calls, queryClient, optionsProxy, user } = renderEditDialog({
        'contentItem.updateText': () => ({ contentItemId: CONTENT_ITEM_ID }),
      });
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

      await user.click(screen.getByRole('button', { name: 'Edit text' }));
      await user.clear(screen.getByLabelText('Title'));
      await user.type(screen.getByLabelText('Title'), 'Updated title');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(calls).toHaveLength(1);
      expect(calls[0].path).toBe('contentItem.updateText');
      expect(calls[0].input).toMatchObject({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        contentItemId: CONTENT_ITEM_ID,
        title: 'Updated title',
        description: 'Some notes',
      });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: optionsProxy.course.view.queryKey({ courseId: COURSE_ID }),
      });
    });
  });
});

describe('RemoveLessonTextButton', () => {
  const renderButton = (
    props: Partial<Parameters<typeof RemoveLessonTextButton>[0]> = {},
    handlers = {},
  ) =>
    renderWithInstructorApi(
      <RemoveLessonTextButton
        courseId={COURSE_ID}
        moduleId={MODULE_ID}
        lessonId={LESSON_ID}
        contentItemId={CONTENT_ITEM_ID}
        title="Key concepts"
        archive={false}
        {...props}
      />,
      { handlers },
    );

  describe('in a draft course (remove)', () => {
    it('warns that this cannot be undone, and Cancel removes nothing', async () => {
      const { calls, user } = renderButton();

      await user.click(
        screen.getByRole('button', { name: 'Remove Key concepts' }),
      );
      expect(screen.getByRole('alertdialog')).toHaveTextContent(
        'Are you sure you want to remove "Key concepts"? This can\'t be undone.',
      );
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(calls).toEqual([]);
    });

    it('removes the item, closes, and refreshes the course view', async () => {
      const { calls, queryClient, optionsProxy, user } = renderButton(
        {},
        { 'contentItem.delete': () => undefined },
      );
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

      await user.click(
        screen.getByRole('button', { name: 'Remove Key concepts' }),
      );
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'Remove text',
        }),
      );

      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
      );
      expect(calls).toEqual([
        {
          path: 'contentItem.delete',
          input: {
            courseId: COURSE_ID,
            moduleId: MODULE_ID,
            lessonId: LESSON_ID,
            contentItemId: CONTENT_ITEM_ID,
          },
        },
      ]);
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: optionsProxy.course.view.queryKey({ courseId: COURSE_ID }),
      });
    });

    it('shows the error when removing fails, and the dialog stays open', async () => {
      const { user } = renderButton(
        {},
        {
          'contentItem.delete': () => {
            throw new ApiError('CONFLICT', 'The item was modified');
          },
        },
      );

      await user.click(
        screen.getByRole('button', { name: 'Remove Key concepts' }),
      );
      await user.click(screen.getByRole('button', { name: 'Remove text' }));

      expect(
        await screen.findByText("Couldn't remove the text"),
      ).toBeInTheDocument();
      expect(screen.getByText('The item was modified')).toBeInTheDocument();
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });
  });

  describe('outside a draft course (archive)', () => {
    it('explains that progress is kept, warns if students used it, and archives on confirm', async () => {
      const { calls, user } = renderButton(
        { archive: true, students: 4 },
        { 'contentItem.delete': () => undefined },
      );

      await user.click(
        screen.getByRole('button', { name: 'Remove Key concepts' }),
      );
      const dialog = screen.getByRole('alertdialog');
      expect(dialog).toHaveTextContent(
        'Students will no longer see "Key concepts"',
      );
      expect(dialog).toHaveTextContent('4 students have used it');

      await user.click(
        within(dialog).getByRole('button', { name: 'Archive text' }),
      );

      await waitFor(() =>
        expect(calls).toEqual([
          {
            path: 'contentItem.delete',
            input: {
              courseId: COURSE_ID,
              moduleId: MODULE_ID,
              lessonId: LESSON_ID,
              contentItemId: CONTENT_ITEM_ID,
            },
          },
        ]),
      );
    });

    it('uses the given noun, e.g. "quiz", in its wording', async () => {
      const { user } = renderButton({ noun: 'quiz' });

      await user.click(
        screen.getByRole('button', { name: 'Remove Key concepts' }),
      );

      expect(screen.getByRole('alertdialog')).toHaveTextContent(
        'Are you sure you want to remove "Key concepts"?',
      );
      expect(
        screen.getByRole('button', { name: 'Remove quiz' }),
      ).toBeInTheDocument();
    });
  });
});
