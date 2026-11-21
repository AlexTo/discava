/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  renderWithCoreApi,
} from '../../../../test/render-with-core-api';
import { FreePreviewPage } from './free-preview-page';

vi.mock('@discava/common-shadcn/components/hls-video', () => ({
  HlsVideo: () => <div data-testid="player" />,
}));

const outline = (freePreview: boolean) => ({
  courseId: 'c1',
  title: 'Linear Algebra',
  status: 'published',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  modules: [
    {
      moduleId: 'm1',
      title: 'Ax = b',
      lessons: [{ lessonId: 'l1', title: 'Welcome', freePreview }],
    },
  ],
});

const previewLesson = (items: unknown[]) => ({
  course: { courseId: 'c1', title: 'Linear Algebra' },
  lesson: {
    lessonId: 'l1',
    moduleId: 'm1',
    title: 'Welcome',
    description: 'Start here.',
  },
  items,
});

const items = [
  {
    type: 'text',
    contentItemId: 'i1',
    title: 'Reading',
    body: JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Some words' }] },
      ],
    }),
  },
  { type: 'video', contentItemId: 'i2', title: 'Intro', playable: true },
  {
    type: 'quiz',
    contentItemId: 'i3',
    title: 'Check',
    questionCount: 2,
  },
];

const renderPage = (
  handlers: Record<string, () => unknown>,
  { signedIn = false, lessonId = 'l1' } = {},
) =>
  renderWithCoreApi(<FreePreviewPage courseId="c1" lessonId={lessonId} />, {
    signedIn,
    handlers,
  });

const paths = (calls: { path: string }[]) => calls.map((c) => c.path);

describe('FreePreviewPage', () => {
  it('shows an open preview: the course, the lesson and its items', async () => {
    const { calls } = renderPage({
      'course.publicView': () => outline(true),
      'freePreview.lesson': () => previewLesson(items),
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Welcome' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Start here.')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Linear Algebra' }),
    ).toHaveAttribute('href', '/learn/c1');
    expect(screen.getByText('Free preview')).toBeInTheDocument();
    expect(screen.getByText('Some words')).toBeInTheDocument();
    expect(screen.getByText('Intro')).toBeInTheDocument();
    expect(screen.getByText('2 questions')).toBeInTheDocument();
    expect(screen.queryByText('Mark as done')).toBeNull();
    expect(screen.queryByText(/progress/i)).toBeNull();
    expect(screen.queryByText(/discussion/i)).toBeNull();
    expect(calls.find((c) => c.path === 'freePreview.lesson')?.input).toEqual({
      courseId: 'c1',
      moduleId: 'm1',
      lessonId: 'l1',
    });
  });

  it('says the preview is gone, with no link, when the course is not found', async () => {
    renderPage({
      'course.publicView': () => {
        throw new ApiError('NOT_FOUND', 'Not found');
      },
    });

    expect(
      await screen.findByText('This preview is no longer available.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it.each([
    ['is missing from the outline', 'other', true],
    ['is not marked', 'l1', false],
  ])(
    'says the preview is gone, without asking for it, when the lesson %s',
    async (_name, lessonId, marked) => {
      const { calls } = renderPage(
        { 'course.publicView': () => outline(marked) },
        { lessonId },
      );

      expect(
        await screen.findByText('This preview is no longer available.'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'View the course' }),
      ).toHaveAttribute('href', '/learn/c1');
      expect(paths(calls)).not.toContain('freePreview.lesson');
    },
  );

  it('says the preview is gone when the lesson is refused', async () => {
    renderPage({
      'course.publicView': () => outline(true),
      'freePreview.lesson': () => {
        throw new ApiError('NOT_FOUND', 'This preview is not available');
      },
    });

    expect(
      await screen.findByText('This preview is no longer available.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'View the course' }),
    ).toBeInTheDocument();
  });

  it('shows an error alert for any other failure', async () => {
    renderPage({
      'course.publicView': () => {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'Boom');
      },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load this preview",
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('says so when the lesson has no items', async () => {
    renderPage({
      'course.publicView': () => outline(true),
      'freePreview.lesson': () => previewLesson([]),
    });

    expect(
      await screen.findByText('This lesson has nothing to show yet.'),
    ).toBeInTheDocument();
  });

  it('reads nothing about the viewer, signed in or not', async () => {
    for (const signedIn of [false, true]) {
      const { calls, unmount } = renderPage(
        {
          'course.publicView': () => outline(true),
          'freePreview.lesson': () => previewLesson(items),
        },
        { signedIn },
      );
      await screen.findByRole('heading', { level: 1, name: 'Welcome' });
      expect(paths(calls)).not.toContain('course.myEnrolment');
      expect(paths(calls)).not.toContain('course.view');
      unmount();
    }
  });
});
