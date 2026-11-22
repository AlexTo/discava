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
import { LessonContentItemsRow } from './lesson-content-items-row';

// Dragging needs real layout, which jsdom doesn't have (the deployed portal is
// checked in a browser for that). Here dnd-kit's provider is replaced by one
// that hands the test the component's own drop handler, so a drop can be
// simulated with the event dnd-kit would send; the real move() helper and the
// component's saving still run.
const dnd = vi.hoisted(() => ({
  onDragEnd: undefined as undefined | ((event: unknown) => void),
}));
vi.mock('@dnd-kit/react', () => ({
  DragDropProvider: ({
    children,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragEnd: (event: unknown) => void;
  }) => {
    dnd.onDragEnd = onDragEnd;
    return children;
  },
}));
vi.mock('@dnd-kit/react/sortable', () => ({
  isSortable: () => true,
  useSortable: () => ({
    ref: () => {},
    handleRef: () => {},
    isDragging: false,
  }),
}));

// The event dnd-kit sends when `id` is dropped at position `to` (0-based),
// over the item that was there.
const drop = (
  id: string,
  from: number,
  to: number,
  overId: string,
  canceled = false,
) =>
  act(() => {
    dnd.onDragEnd?.({
      canceled,
      operation: {
        canceled,
        source: { id, initialIndex: from, index: to },
        target: { id: overId },
      },
    });
  });

const keys = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
};
const item = (id: string, title: string) => ({
  contentItemId: id,
  type: 'text',
  title,
  body: '{}',
  status: 'ready',
  visibility: 'visible' as const,
});
const items = [item('a', 'Item A'), item('b', 'Item B'), item('c', 'Item C')];

const renderRow = (
  props: Partial<Parameters<typeof LessonContentItemsRow>[0]> = {},
  handlers = {},
) =>
  renderWithInstructorApi(
    <LessonContentItemsRow
      {...keys}
      contentItems={items}
      archive={false}
      {...props}
    />,
    { handlers },
  );

const reorderHandles = () =>
  screen.queryAllByRole('button', { name: /^Reorder / });

describe('LessonContentItemsRow', () => {
  it('gives every item a reorder handle, labelled with its title', () => {
    renderRow();

    expect(
      reorderHandles().map((handle) => handle.getAttribute('aria-label')),
    ).toEqual(['Reorder Item A', 'Reorder Item B', 'Reorder Item C']);
  });

  it('has no handle when there is only one item to order', () => {
    renderRow({ contentItems: [items[0]] });

    expect(reorderHandles()).toEqual([]);
    expect(screen.getByText('Item A')).toBeInTheDocument();
  });

  // An archived course is read-only.
  it('in an archived course, lists the items with no handles and no editing controls', () => {
    renderRow({ readOnly: true });

    expect(screen.getAllByText(/^Item [ABC]$/)).toHaveLength(3);
    expect(reorderHandles()).toEqual([]);
    expect(
      screen.queryByRole('button', { name: /^(Publish|Hide|Edit|Remove) / }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Video' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Text' })).toBeNull();
  });

  it('saves the whole new order when an item is dropped, showing it straight away', async () => {
    const { calls } = renderRow({}, { 'contentItem.reorder': () => [] });

    await drop('a', 0, 1, 'b');

    expect(
      screen.getAllByText(/^Item [ABC]$/).map((node) => node.textContent),
    ).toEqual(['Item B', 'Item A', 'Item C']);
    await waitFor(() =>
      expect(calls).toContainEqual({
        path: 'contentItem.reorder',
        input: { ...keys, contentItemIds: ['b', 'a', 'c'] },
      }),
    );
  });

  it('saves nothing when a drag is cancelled, or an item is dropped where it was', async () => {
    const { calls } = renderRow({}, { 'contentItem.reorder': () => [] });

    await drop('a', 0, 1, 'b', true);
    await drop('b', 1, 1, 'b');

    expect(calls.filter(({ path }) => path === 'contentItem.reorder')).toEqual(
      [],
    );
  });

  it('on CONFLICT, puts the order back and says the lesson changed and was reloaded', async () => {
    const { queryClient, optionsProxy } = renderRow(
      {},
      {
        'contentItem.reorder': () => {
          throw new ApiError('CONFLICT', "The lesson's content items changed");
        },
      },
    );

    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await drop('a', 0, 2, 'c');

    expect(
      await screen.findByText(
        'This lesson changed while you were reordering it. It has been reloaded, so try again.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/^Item [ABC]$/).map((node) => node.textContent),
    ).toEqual(['Item A', 'Item B', 'Item C']);
    // The reload: the course view is refreshed.
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: optionsProxy.course.view.queryKey({
          courseId: keys.courseId,
        }),
      }),
    );
  });

  it('shows any other failure as it came from the API, and puts the order back', async () => {
    renderRow(
      {},
      {
        'contentItem.reorder': () => {
          throw new ApiError('PRECONDITION_FAILED', 'Restore the lesson first');
        },
      },
    );

    await drop('c', 2, 0, 'a');

    expect(
      await screen.findByText('Restore the lesson first'),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Couldn't reorder the content"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/^Item [ABC]$/).map((node) => node.textContent),
    ).toEqual(['Item A', 'Item B', 'Item C']);
  });

  it('shows a quiz with its question count, and opens it to edit in the builder', async () => {
    const quiz = {
      ...item('q', 'Module check'),
      type: 'quiz',
      questions: [{}, {}, {}],
    };
    const { user } = renderRow(
      { contentItems: [quiz] },
      {
        'course.view': () => ({
          status: 'published',
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
                      ...quiz,
                      questions: [],
                      answerKey: {},
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
        }),
      },
    );

    expect(screen.getByText('3 questions')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Hide quiz Module check' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit Module check' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Edit Module check',
    });
    expect(
      await within(dialog).findByText('In Module One › Lesson One'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveValue(
      'Module check',
    );
  });

  it('opens a new quiz in the builder from the Quiz button', async () => {
    const { user } = renderRow({}, { 'course.view': () => ({ modules: [] }) });

    await user.click(screen.getByRole('button', { name: 'Quiz' }));

    const dialog = await screen.findByRole('dialog', { name: 'New quiz' });
    expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveValue(
      '',
    );
  });

  it('in an archived course, offers no Quiz button', () => {
    renderRow({ readOnly: true });

    expect(screen.queryByRole('button', { name: 'Quiz' })).toBeNull();
  });

  describe('a file (#102)', () => {
    const file = {
      contentItemId: 'f',
      type: 'file',
      title: 'Week 1 slides',
      status: 'ready',
      fileName: 'week-1.pdf',
      fileSize: 1536,
      visibility: 'visible' as const,
    };

    it('shows its kind and size, with the controls other items have', () => {
      renderRow({ contentItems: [file] });

      expect(screen.getByText('PDF · 1.5 KB')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Hide file Week 1 slides' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Remove Week 1 slides' }),
      ).toBeInTheDocument();
    });

    it('opens it to edit, showing the file attached now', async () => {
      const { user } = renderRow({ contentItems: [file] });

      await user.click(
        screen.getByRole('button', { name: 'Edit Week 1 slides' }),
      );

      const dialog = await screen.findByRole('dialog', { name: 'Edit file' });
      expect(within(dialog).getByLabelText('Title')).toHaveValue(
        'Week 1 slides',
      );
      expect(within(dialog).getByText('week-1.pdf')).toBeInTheDocument();
    });

    it('opens an empty Add file dialog from the File button', async () => {
      const { user } = renderRow();

      await user.click(screen.getByRole('button', { name: 'File' }));

      const dialog = await screen.findByRole('dialog', { name: 'Add file' });
      expect(within(dialog).getByLabelText('Title')).toHaveValue('');
    });

    it('in an archived course, offers no File button', () => {
      renderRow({ readOnly: true });

      expect(screen.queryByRole('button', { name: 'File' })).toBeNull();
    });
  });

  describe('a video being replaced (#209)', () => {
    const video = (status: string) => ({
      contentItemId: 'v',
      type: 'video',
      title: 'Lecture',
      status,
      previousS3Key: 'courses/c/content-items/v/old-nonce/master.m3u8',
      visibility: 'visible' as const,
    });

    it('says students still see the previous version while it processes', async () => {
      const { user } = renderRow(
        { contentItems: [video('pending')] },
        { 'course.view': () => ({ modules: [] }) },
      );

      await user.click(screen.getByRole('button', { name: 'Edit Lecture' }));

      expect(
        await screen.findByText(
          'Students still see the previous version until this one is ready.',
        ),
      ).toBeInTheDocument();
    });

    it('says so when the replacement failed', async () => {
      const { user } = renderRow({ contentItems: [video('failed')] });

      await user.click(screen.getByRole('button', { name: 'Edit Lecture' }));

      expect(
        await screen.findByText(/Students still see the previous version\./),
      ).toBeInTheDocument();
    });
  });
  describe('a video row', () => {
    const readyVideo = (extra: Record<string, unknown> = {}) => ({
      contentItemId: 'v1',
      type: 'video',
      title: 'Lecture',
      status: 'ready',
      visibility: 'visible' as const,
      ...extra,
    });

    it.each([
      [{ captionsStatus: 'pending' }, 'Captions: generating'],
      [{ captionsStatus: 'ready', captionTrackCount: 1 }, 'Captions: ready'],
      [{ captionsStatus: 'failed' }, 'Captions: failed'],
      [{}, 'Captions: none'],
    ])('shows the caption status for %j as "%s"', (extra, text) => {
      renderRow({ contentItems: [readyVideo(extra)] });

      expect(screen.getByText(text)).toBeInTheDocument();
    });

    it('reads as ready when an upload fixed a failed automatic captioning', () => {
      renderRow({
        contentItems: [
          readyVideo({ captionsStatus: 'failed', captionTrackCount: 1 }),
        ],
      });

      expect(screen.getByText('Captions: ready')).toBeInTheDocument();
    });

    it('opens the captions dialog from the row', async () => {
      const { user } = renderRow(
        { contentItems: [readyVideo()] },
        {
          'contentItem.createVideoUrl': () => ({
            url: 'https://media.test/master.m3u8',
            withCredentials: false,
            versionId: 'v',
            captions: [],
          }),
        },
      );

      await user.click(
        screen.getByRole('button', { name: 'Captions for Lecture' }),
      );

      expect(
        await screen.findByRole('dialog', { name: 'Captions' }),
      ).toBeInTheDocument();
    });

    it('offers no captions before the video is ready', () => {
      renderRow({ contentItems: [readyVideo({ status: 'pending' })] });

      expect(screen.queryByText(/^Captions:/)).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Captions for Lecture' }),
      ).toBeNull();
    });

    it('labels the Questions button with the count, when there are any', () => {
      renderRow({
        contentItems: [
          readyVideo({ questions: [{}, {}, {}] }),
          readyVideo({ contentItemId: 'v2', title: 'Other' }),
        ],
      });

      expect(
        screen.getByRole('button', { name: 'Questions for Lecture' }),
      ).toHaveTextContent('Questions (3)');
      expect(
        screen.getByRole('button', { name: 'Questions for Other' }),
      ).toHaveTextContent(/^Questions$/);
    });

    it('opens the questions editor from the row', async () => {
      const { user } = renderRow(
        { contentItems: [readyVideo()] },
        {
          'contentItem.createVideoUrl': () => ({
            url: 'https://media.test/master.m3u8',
            withCredentials: false,
            versionId: 'v',
            captions: [],
          }),
          'course.view': () => ({
            status: 'published',
            modules: [
              {
                moduleId: 'module-1',
                title: 'Module',
                lessons: [
                  {
                    lessonId: 'lesson-1',
                    title: 'Lesson',
                    contentItems: [readyVideo({ studentActivityCount: 0 })],
                  },
                ],
              },
            ],
          }),
        },
      );

      await user.click(
        screen.getByRole('button', { name: 'Questions for Lecture' }),
      );

      expect(
        await screen.findByRole('dialog', { name: 'Questions' }),
      ).toBeInTheDocument();
    });

    it('disables the Questions button, with the reason, while the video has no playable version', () => {
      renderRow({ contentItems: [readyVideo({ status: 'pending' })] });

      const button = screen.getByRole('button', {
        name: 'Questions for Lecture',
      });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute(
        'title',
        expect.stringMatching(/no playable version/),
      );
    });

    it('enables it for a video being replaced over a version that plays', () => {
      renderRow({
        contentItems: [
          readyVideo({ status: 'processing', previousS3Key: 'old.m3u8' }),
        ],
      });

      expect(
        screen.getByRole('button', { name: 'Questions for Lecture' }),
      ).toBeEnabled();
    });

    it('in an archived course, still offers Questions, to be read there', () => {
      renderRow({ contentItems: [readyVideo()], readOnly: true });

      expect(
        screen.getByRole('button', { name: 'Questions for Lecture' }),
      ).toBeEnabled();
    });

    it('in an archived course, shows the status but offers no Captions button', () => {
      renderRow({ contentItems: [readyVideo()], readOnly: true });

      expect(screen.getByText('Captions: none')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Captions for Lecture' }),
      ).toBeNull();
    });
  });

  it("shows each kind of item's whole title, wrapping rather than truncating", () => {
    const long = 'A very long item title '.repeat(4).trim();
    renderRow({
      contentItems: [
        item('t', `${long} text`),
        { ...item('v', `${long} video`), type: 'video' },
        { ...item('f', `${long} file`), type: 'file' },
        { ...item('q', `${long} quiz`), type: 'quiz', questions: [] },
      ] as never,
    });

    for (const kind of ['text', 'video', 'file', 'quiz']) {
      const title = screen.getByText(`${long} ${kind}`);
      expect(title).toBeVisible();
      expect(title).toHaveClass('min-w-0', 'flex-1', 'break-words');
      expect(title).not.toHaveClass('truncate');
    }
  });

  it("lets the row's controls wrap, and keeps the add buttons together", () => {
    renderRow();

    const row = screen.getByText('Item A').parentElement;
    expect(row).toHaveClass('flex-wrap');
    expect(
      screen.getByRole('button', { name: 'Video' }).parentElement,
    ).toHaveClass('flex-wrap');
  });
});
