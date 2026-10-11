/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithInstructorApi } from '../../../../../../../test/render-with-instructor-api';
import { QuizBuilderDialog } from './quiz-builder-dialog';

// Tiptap needs layout APIs jsdom lacks; a textarea stands in.
vi.mock('../../rich-text-editor', () => ({
  RichTextEditor: ({ ariaLabel }: { ariaLabel?: string }) => (
    <textarea aria-label={ariaLabel} />
  ),
}));

const keys = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
};

const courseView = (
  overrides: { status?: string; quizArchivedAt?: string } = {},
) => ({
  status: overrides.status ?? 'published',
  modules: [
    {
      moduleId: 'module-1',
      title: 'Module One',
      lessons: [
        {
          lessonId: 'lesson-1',
          title: 'Lesson One',
          contentItems: [
            {
              contentItemId: 'quiz-1',
              type: 'quiz',
              title: 'Module check',
              archivedAt: overrides.quizArchivedAt,
              studentActivityCount: 0,
              questions: [
                {
                  questionId: 'q1',
                  kind: 'single',
                  prompt: '{"type":"doc","content":[{"type":"paragraph"}]}',
                  options: [
                    { optionId: 'a', text: 'Yes' },
                    { optionId: 'b', text: 'No' },
                  ],
                },
              ],
              answerKey: { q1: { correctOptionIds: ['a'] } },
              settings: {
                passMarkPercent: 70,
                attemptsAllowed: null,
                shuffleOptions: false,
                revealAnswers: 'never',
              },
              quizVersion: 2,
            },
          ],
        },
      ],
    },
  ],
});

const renderDialog = (contentItemId?: string, view = courseView()) =>
  renderWithInstructorApi(
    <QuizBuilderDialog
      {...keys}
      contentItemId={contentItemId}
      trigger={<button type="button">Open</button>}
    />,
    { handlers: { 'course.view': () => view } },
  );

describe('QuizBuilderDialog', () => {
  it('opens an existing quiz from course.view, saying where it is', async () => {
    const { user } = renderDialog('quiz-1');

    await user.click(screen.getByRole('button', { name: 'Open' }));

    const dialog = screen.getByRole('dialog', { name: 'Edit Module check' });
    expect(
      await within(dialog).findByRole('textbox', { name: 'Title' }),
    ).toHaveValue('Module check');
    expect(
      within(dialog).getByText('In Module One › Lesson One'),
    ).toBeInTheDocument();
  });

  it('opens an archived quiz read-only', async () => {
    const { user } = renderDialog(
      'quiz-1',
      courseView({ quizArchivedAt: '2026-10-01T00:00:00.000Z' }),
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(
      await screen.findByText(/This quiz is archived/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save quiz/i })).toBeNull();
    // Only Close is offered, and it closes the dialog.
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes straight away with nothing unsaved', async () => {
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes from the Close button, asking first if there are unsaved changes', async () => {
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Draft');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(
      screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' }),
    ).toBeInTheDocument();
  });

  it('asks before discarding unsaved changes, and starts a new quiz afresh', async () => {
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Draft');
    await user.keyboard('{Escape}');

    const confirm = screen.getByRole('alertdialog', {
      name: 'Discard unsaved changes?',
    });
    await user.click(
      within(confirm).getByRole('button', { name: 'Keep editing' }),
    );
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Draft');

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('');
  });
});
