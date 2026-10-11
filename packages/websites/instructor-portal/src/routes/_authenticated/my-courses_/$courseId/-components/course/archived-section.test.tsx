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
import { ArchivedSection, archivedEntries } from './archived-section';

const COURSE_ID = 'course-1';
const item = (id: string, extra: Record<string, unknown> = {}) => ({
  contentItemId: id,
  type: 'text',
  title: `Item ${id}`,
  studentActivityCount: 0,
  ...extra,
});

// Module One is active, with Lesson One active (one archived item) and Lesson
// Two archived. Module Two is archived, with a lesson and items under it.
const modules = [
  {
    moduleId: 'm1',
    title: 'Module One',
    lessons: [
      {
        lessonId: 'l1',
        title: 'Lesson One',
        contentItems: [
          item('a'),
          item('b', {
            archivedAt: '2024-03-03T00:00:00.000Z',
            type: 'video',
            studentActivityCount: 4,
          }),
        ],
      },
      {
        lessonId: 'l2',
        title: 'Lesson Two',
        archivedAt: '2024-03-01T00:00:00.000Z',
        contentItems: [
          item('c'),
          item('d', { archivedAt: '2024-02-01T00:00:00.000Z' }),
        ],
      },
    ],
  },
  {
    moduleId: 'm2',
    title: 'Module Two',
    archivedAt: '2024-03-02T00:00:00.000Z',
    lessons: [
      {
        lessonId: 'l3',
        title: 'Lesson Three',
        contentItems: [item('e', { studentActivityCount: 1 }), item('f')],
      },
    ],
  },
];

describe('archivedEntries', () => {
  it('lists only records archived in their own right, most recent first', () => {
    expect(
      archivedEntries(modules).map(({ kind, title, location, contents }) => ({
        kind,
        title,
        location,
        contents,
      })),
    ).toEqual([
      {
        kind: 'item',
        title: 'Item b',
        location: 'Module One › Lesson One',
        contents: undefined,
      },
      {
        kind: 'module',
        title: 'Module Two',
        location: undefined,
        contents: '1 lesson, 2 items',
      },
      {
        kind: 'lesson',
        title: 'Lesson Two',
        location: 'Module One',
        contents: '2 items',
      },
    ]);
  });

  it('counts what students have used: students for an item, used items for a module or lesson', () => {
    const [itemB, moduleTwo, lessonTwo] = archivedEntries(modules);

    expect(itemB.activity).toEqual({ students: 4 });
    expect(moduleTwo.activity).toEqual({ items: 1 });
    expect(lessonTwo.activity).toEqual({ items: 0 });
  });
});

const renderSection = (readOnly = false, handlers = {}) =>
  renderWithInstructorApi(
    <ArchivedSection
      courseId={COURSE_ID}
      modules={modules}
      readOnly={readOnly}
    />,
    { handlers },
  );

describe('ArchivedSection', () => {
  it('renders nothing when nothing is archived', () => {
    const { container } = renderWithInstructorApi(
      <ArchivedSection
        courseId={COURSE_ID}
        modules={[{ moduleId: 'm1', title: 'M', lessons: [] }]}
        readOnly={false}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows each record with where it was, what is in it and whether students used it', () => {
    renderSection();

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Item b (video)');
    expect(rows[0]).toHaveTextContent('in Module One › Lesson One');
    expect(rows[0]).toHaveTextContent('4 students have used it');
    expect(rows[1]).toHaveTextContent('Module Two (module)');
    expect(rows[1]).toHaveTextContent('1 lesson, 2 items');
    expect(rows[1]).toHaveTextContent('Students have used 1 item in it');
    expect(rows[2]).toHaveTextContent('Lesson Two (lesson)');
    expect(rows[2]).not.toHaveTextContent('used');
  });

  it('restores a lesson with its keys and refreshes the course view', async () => {
    const { calls, queryClient, optionsProxy, user } = renderSection(false, {
      'lesson.restore': () => ({}),
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(
      screen.getByRole('button', { name: 'Restore lesson Lesson Two' }),
    );

    await waitFor(() =>
      expect(calls).toEqual([
        {
          path: 'lesson.restore',
          input: { courseId: COURSE_ID, moduleId: 'm1', lessonId: 'l2' },
        },
      ]),
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: optionsProxy.course.view.queryKey({ courseId: COURSE_ID }),
      }),
    );
  });

  it('restores an item and a module with their own keys', async () => {
    const { calls, user } = renderSection(false, {
      'contentItem.restore': () => ({}),
      'module.restore': () => ({}),
    });

    await user.click(
      screen.getByRole('button', { name: 'Restore video Item b' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Restore module Module Two' }),
    );

    await waitFor(() =>
      expect(calls).toEqual([
        {
          path: 'contentItem.restore',
          input: {
            courseId: COURSE_ID,
            moduleId: 'm1',
            lessonId: 'l1',
            contentItemId: 'b',
          },
        },
        {
          path: 'module.restore',
          input: { courseId: COURSE_ID, moduleId: 'm2' },
        },
      ]),
    );
  });

  it('shows a refused restore under its row', async () => {
    const { user } = renderSection(false, {
      'lesson.restore': () => {
        throw new ApiError('PRECONDITION_FAILED', 'Restore the module first');
      },
    });

    await user.click(
      screen.getByRole('button', { name: 'Restore lesson Lesson Two' }),
    );

    const row = screen.getAllByRole('listitem')[2];
    await waitFor(() =>
      expect(row).toHaveTextContent("Couldn't restore the lesson"),
    );
    expect(row).toHaveTextContent('Restore the module first');
  });

  describe('Delete permanently', () => {
    it('confirms, saying everything in it goes for good, then deletes it', async () => {
      const { calls, user } = renderSection(false, {
        'lesson.deletePermanently': () => ({}),
      });

      await user.click(
        screen.getByRole('button', {
          name: 'Delete lesson Lesson Two permanently',
        }),
      );
      const dialog = screen.getByRole('alertdialog');
      expect(dialog).toHaveTextContent(
        `"Lesson Two" and everything in it will be deleted for good (2 items). This can't be undone.`,
      );
      await user.click(
        within(dialog).getByRole('button', { name: 'Delete permanently' }),
      );

      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
      );
      expect(calls).toEqual([
        {
          path: 'lesson.deletePermanently',
          input: { courseId: COURSE_ID, moduleId: 'm1', lessonId: 'l2' },
        },
      ]);
    });

    it('Cancel deletes nothing', async () => {
      const { calls, user } = renderSection();

      await user.click(
        screen.getByRole('button', {
          name: 'Delete lesson Lesson Two permanently',
        }),
      );
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(calls).toEqual([]);
    });

    it('shows a refusal, such as the size limit and its next step, in the dialog', async () => {
      const { user } = renderSection(false, {
        'lesson.deletePermanently': () => {
          throw new ApiError(
            'PRECONDITION_FAILED',
            'This lesson has too many content items to delete in one operation (the limit is 100 records). Delete some of its content items first, then the lesson.',
          );
        },
      });

      await user.click(
        screen.getByRole('button', {
          name: 'Delete lesson Lesson Two permanently',
        }),
      );
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'Delete permanently',
        }),
      );

      const dialog = screen.getByRole('alertdialog');
      await waitFor(() =>
        expect(dialog).toHaveTextContent("Couldn't delete the lesson"),
      );
      expect(dialog).toHaveTextContent(
        'Delete some of its content items first, then the lesson.',
      );
    });

    // Student data is never deleted: the API refuses, so the button says why up front.
    it('is unavailable, with the reason, when students have used it or anything in it', () => {
      renderSection();

      for (const name of [
        'Delete video Item b permanently (not possible: students have used it)',
        'Delete module Module Two permanently (not possible: students have used it)',
      ]) {
        expect(screen.getByRole('button', { name })).toBeDisabled();
      }
    });
  });

  // An archived course is read-only until it's restored; only permanent
  // deletes of archived records remain.
  it('in an archived course, offers no Restore but still Delete permanently', () => {
    renderSection(true);

    expect(screen.queryByRole('button', { name: /^Restore / })).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Delete lesson Lesson Two permanently',
      }),
    ).toBeEnabled();
    expect(
      screen.getByText(/Restore the course to restore these/),
    ).toBeInTheDocument();
  });
});
