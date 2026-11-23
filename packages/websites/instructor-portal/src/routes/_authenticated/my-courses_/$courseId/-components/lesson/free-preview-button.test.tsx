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
import { CourseModules } from '../course/course-modules';
import { FreePreviewBadge } from './free-preview-badge';
import { FreePreviewButton } from './free-preview-button';

const key = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
};

const renderButton = (
  freePreview: boolean,
  handlers: Parameters<typeof renderWithInstructorApi>[1] = {},
) =>
  renderWithInstructorApi(
    <FreePreviewButton {...key} title="Lesson One" freePreview={freePreview} />,
    handlers,
  );

describe('FreePreviewButton', () => {
  it('marks only after the confirmation', async () => {
    const { calls, user } = renderButton(false, {
      handlers: { 'lesson.setFreePreview': () => ({}) },
    });

    await user.click(screen.getByRole('button', { name: 'Make free preview' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Anyone will be able to open this lesson without enrolling or paying: its videos, text and files. Quizzes stay locked.',
    );
    expect(calls).toEqual([]);

    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Make free preview',
      }),
    );

    await waitFor(() =>
      expect(calls).toEqual([
        { path: 'lesson.setFreePreview', input: { ...key, freePreview: true } },
      ]),
    );
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
  });

  it('keeps focus on the button after marking', async () => {
    const { user } = renderButton(false, {
      handlers: { 'lesson.setFreePreview': () => ({}) },
    });
    const button = screen.getByRole('button', { name: 'Make free preview' });

    await user.click(button);
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Make free preview',
      }),
    );

    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    expect(button).toHaveFocus();
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    const { calls, user } = renderButton(false);

    await user.click(screen.getByRole('button', { name: 'Make free preview' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    expect(calls).toEqual([]);
  });

  it('removes the mark at once, without a confirmation', async () => {
    const { calls, user } = renderButton(true, {
      handlers: { 'lesson.setFreePreview': () => ({}) },
    });

    const button = screen.getByRole('button', { name: 'Remove free preview' });
    await user.click(button);

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    await waitFor(() =>
      expect(calls).toEqual([
        {
          path: 'lesson.setFreePreview',
          input: { ...key, freePreview: false },
        },
      ]),
    );
  });

  it("shows the API's message when marking fails, keeping the dialog open", async () => {
    const { user } = renderButton(false, {
      handlers: {
        'lesson.setFreePreview': () => {
          throw new ApiError('PRECONDITION_FAILED', 'Restore the course first');
        },
      },
    });

    await user.click(screen.getByRole('button', { name: 'Make free preview' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Make free preview',
      }),
    );

    expect(await screen.findByText('Restore the course first')).toBeVisible();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it("shows the API's message when removing fails", async () => {
    const { user } = renderButton(true, {
      handlers: {
        'lesson.setFreePreview': () => {
          throw new ApiError('PRECONDITION_FAILED', 'Restore the lesson first');
        },
      },
    });

    await user.click(
      screen.getByRole('button', { name: 'Remove free preview' }),
    );

    expect(await screen.findByText('Restore the lesson first')).toBeVisible();
  });
});

describe('FreePreviewBadge', () => {
  it('says "Free preview" when the lesson is open', () => {
    renderWithInstructorApi(<FreePreviewBadge open />);
    expect(screen.getByText('Free preview')).toBeInTheDocument();
  });

  it('says it is not public yet otherwise', () => {
    renderWithInstructorApi(<FreePreviewBadge open={false} />);
    expect(
      screen.getByText('Free preview (not public yet)'),
    ).toBeInTheDocument();
  });
});

describe('free preview in the course editor', () => {
  const lesson = (overrides: Record<string, unknown> = {}) => ({
    lessonId: 'l1',
    kind: 'lesson' as const,
    title: 'Lesson A',
    visibility: 'visible' as const,
    contentItems: [],
    ...overrides,
  });
  const renderEditor = ({
    lessons,
    moduleVisibility = 'visible' as 'visible' | 'hidden',
    draft = false,
  }: {
    lessons: ReturnType<typeof lesson>[];
    moduleVisibility?: 'visible' | 'hidden';
    draft?: boolean;
  }) =>
    renderWithInstructorApi(
      <CourseModules
        courseId="course-1"
        archive={false}
        readOnly={false}
        draft={draft}
        modules={[
          {
            moduleId: 'm1',
            title: 'Module A',
            visibility: moduleVisibility,
            lessons,
          },
        ]}
      />,
    );

  it('offers Make free preview on an unmarked lesson and Remove on a marked one, none on an assignment', () => {
    renderEditor({
      lessons: [
        lesson({ lessonId: 'l1', title: 'Plain' }),
        lesson({ lessonId: 'l2', title: 'Marked', freePreview: true }),
        lesson({ lessonId: 'l3', title: 'Graded work', kind: 'assignment' }),
      ],
    });

    const row = (title: string) =>
      screen.getAllByText(title)[0].closest('article') as HTMLElement;
    expect(
      within(row('Plain')).getByRole('button', { name: 'Make free preview' }),
    ).toBeInTheDocument();
    expect(
      within(row('Marked')).getByRole('button', {
        name: 'Remove free preview',
      }),
    ).toBeInTheDocument();
    expect(
      within(row('Graded work')).queryByRole('button', {
        name: /free preview/i,
      }),
    ).not.toBeInTheDocument();
  });

  it('badges a marked lesson in a published course as Free preview', () => {
    renderEditor({ lessons: [lesson({ freePreview: true })] });
    expect(screen.getByText('Free preview')).toBeInTheDocument();
  });

  it.each([
    [
      'a draft course',
      { draft: true, lessons: [lesson({ freePreview: true })] },
    ],
    [
      'a hidden module',
      {
        moduleVisibility: 'hidden' as const,
        lessons: [lesson({ freePreview: true })],
      },
    ],
    [
      'a hidden lesson',
      {
        lessons: [lesson({ freePreview: true, visibility: 'hidden' as const })],
      },
    ],
  ])('badges a marked lesson in %s as not public yet', (_name, props) => {
    renderEditor(props);
    expect(
      screen.getByText('Free preview (not public yet)'),
    ).toBeInTheDocument();
  });

  it('shows no badge on an unmarked lesson', () => {
    renderEditor({ lessons: [lesson()] });
    expect(screen.queryByText(/^Free preview/)).not.toBeInTheDocument();
  });
});
