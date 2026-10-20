/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  renderWithInstructorApi,
} from '../../../../../../test/render-with-instructor-api';
import { CourseModules } from './course-modules';

// Dragging needs real layout, which jsdom doesn't have (the deployed portal is
// checked in a browser for that). Here dnd-kit's provider is replaced by one
// that hands each sortable row its own list's drop handler, so a drop can be
// simulated with the event dnd-kit would send, in whichever of the nested lists
// (modules, a module's lessons, a lesson's content items) owns the row; the
// real move() helper and the component's saving still run.
const dnd = vi.hoisted(() => ({
  onDragEndById: new Map<string, (event: unknown) => void>(),
  Context: undefined as unknown,
}));
vi.mock('@dnd-kit/react', async () => {
  const { createContext, createElement } = await import('react');
  const Context = createContext<((event: unknown) => void) | undefined>(
    undefined,
  );
  dnd.Context = Context;
  return {
    DragDropProvider: ({
      children,
      onDragEnd,
    }: {
      children: React.ReactNode;
      onDragEnd: (event: unknown) => void;
    }) => createElement(Context.Provider, { value: onDragEnd }, children),
  };
});
vi.mock('@dnd-kit/react/sortable', async () => {
  const { useContext } = await import('react');
  return {
    isSortable: () => true,
    useSortable: ({ id }: { id: string }) => {
      const onDragEnd = useContext(dnd.Context as React.Context<unknown>);
      dnd.onDragEndById.set(id, onDragEnd as (event: unknown) => void);
      return { ref: () => {}, handleRef: () => {}, isDragging: false };
    },
  };
});

// The event dnd-kit sends when `id` is dropped at position `to` (0-based),
// over the row that was there.
const drop = (id: string, from: number, to: number, overId: string) =>
  act(() => {
    dnd.onDragEndById.get(id)?.({
      canceled: false,
      operation: {
        canceled: false,
        source: { id, initialIndex: from, index: to },
        target: { id: overId },
      },
    });
  });

const COURSE_ID = 'course-1';
const lesson = (id: string, title: string) => ({
  lessonId: id,
  title,
  visibility: 'visible' as const,
  contentItems: [],
});
const module = (id: string, title: string, lessons = [] as unknown[]) => ({
  moduleId: id,
  title,
  visibility: 'visible' as const,
  lessons: lessons as ReturnType<typeof lesson>[],
});
const modules = [
  module('m1', 'Module A', [
    lesson('l1', 'Lesson A1'),
    lesson('l2', 'Lesson A2'),
    lesson('l3', 'Lesson A3'),
  ]),
  module('m2', 'Module B', [lesson('l4', 'Lesson B1')]),
  module('m3', 'Module C'),
];

const renderModules = (
  props: Partial<Parameters<typeof CourseModules>[0]> = {},
  handlers = {},
) =>
  renderWithInstructorApi(
    <CourseModules
      courseId={COURSE_ID}
      modules={modules}
      archive={false}
      readOnly={false}
      draft={false}
      {...props}
    />,
    { handlers },
  );

const reorderHandles = () =>
  screen
    .queryAllByRole('button', { name: /^Reorder / })
    .map((handle) => handle.getAttribute('aria-label'));

const moduleTitles = () =>
  screen.getAllByText(/^Module [ABC]$/).map((node) => node.textContent);
const lessonTitles = () =>
  screen.getAllByText(/^Lesson A\d$/).map((node) => node.textContent);

describe('CourseModules', () => {
  it('gives every module, and every lesson of a module with more than one, a reorder handle labelled with its title', () => {
    renderModules();

    expect(reorderHandles()).toEqual([
      'Reorder Module A',
      'Reorder Lesson A1',
      'Reorder Lesson A2',
      'Reorder Lesson A3',
      'Reorder Module B',
      'Reorder Module C',
    ]);
  });

  it('has no module handle when there is only one module', () => {
    renderModules({ modules: [modules[0]] });

    expect(reorderHandles()).not.toContain('Reorder Module A');
  });

  // An archived course is read-only.
  it('in an archived course, shows modules and lessons with no handles', () => {
    renderModules({ readOnly: true });

    expect(moduleTitles()).toEqual(['Module A', 'Module B', 'Module C']);
    expect(lessonTitles()).toEqual(['Lesson A1', 'Lesson A2', 'Lesson A3']);
    expect(reorderHandles()).toEqual([]);
  });

  it('saves the whole new module order when a module is dropped, showing it and its numbering straight away', async () => {
    const { calls } = renderModules({}, { 'module.reorder': () => [] });

    await drop('m3', 2, 0, 'm1');

    expect(moduleTitles()).toEqual(['Module C', 'Module A', 'Module B']);
    expect(
      screen.getByRole('button', { name: 'Edit module 1' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(calls).toContainEqual({
        path: 'module.reorder',
        input: { courseId: COURSE_ID, moduleIds: ['m3', 'm1', 'm2'] },
      }),
    );
  });

  it('saves the whole new lesson order of the module when a lesson is dropped', async () => {
    const { calls } = renderModules({}, { 'lesson.reorder': () => [] });

    await drop('l1', 0, 2, 'l3');

    expect(lessonTitles()).toEqual(['Lesson A2', 'Lesson A3', 'Lesson A1']);
    await waitFor(() =>
      expect(calls).toContainEqual({
        path: 'lesson.reorder',
        input: {
          courseId: COURSE_ID,
          moduleId: 'm1',
          lessonIds: ['l2', 'l3', 'l1'],
        },
      }),
    );
    expect(calls.some(({ path }) => path === 'module.reorder')).toBe(false);
  });

  it('on CONFLICT reordering modules, puts the order back, says the course changed and reloads it', async () => {
    const { queryClient, optionsProxy } = renderModules(
      {},
      {
        'module.reorder': () => {
          throw new ApiError('CONFLICT', "The course's modules changed");
        },
      },
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await drop('m1', 0, 2, 'm3');

    expect(
      await screen.findByText(
        'This course changed while you were reordering its modules. It has been reloaded, so try again.',
      ),
    ).toBeInTheDocument();
    expect(moduleTitles()).toEqual(['Module A', 'Module B', 'Module C']);
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: optionsProxy.course.view.queryKey({ courseId: COURSE_ID }),
      }),
    );
  });

  it('on CONFLICT reordering lessons, puts the order back and says the module changed', async () => {
    renderModules(
      {},
      {
        'lesson.reorder': () => {
          throw new ApiError('CONFLICT', "The module's lessons changed");
        },
      },
    );

    await drop('l3', 2, 0, 'l1');

    expect(
      await screen.findByText(
        'This module changed while you were reordering its lessons. It has been reloaded, so try again.',
      ),
    ).toBeInTheDocument();
    expect(lessonTitles()).toEqual(['Lesson A1', 'Lesson A2', 'Lesson A3']);
  });

  it('shows any other failure as it came from the API', async () => {
    renderModules(
      {},
      {
        'lesson.reorder': () => {
          throw new ApiError('PRECONDITION_FAILED', 'Restore the module first');
        },
      },
    );

    await drop('l2', 1, 0, 'l1');

    const alert = (await screen.findByText('Restore the module first')).closest(
      '[role="alert"]',
    ) as HTMLElement | null;
    expect(
      alert ? within(alert).getByText("Couldn't reorder the lessons") : null,
    ).toBeInTheDocument();
  });
});
