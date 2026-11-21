/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithCoreApi } from '../../../../test/render-with-core-api';
import { LessonPage } from './lesson-page';

// The player is stubbed to show what it was given; its own behaviour is
// tested with HlsVideo.
vi.mock('@discava/common-shadcn/components/hls-video', () => ({
  HlsVideo: ({
    title,
    startAt,
    transcript,
  }: {
    title: string;
    startAt?: number;
    transcript?: boolean;
  }) => (
    <div
      data-testid={`player-${title}`}
      data-start-at={startAt ?? 'none'}
      data-transcript={String(transcript)}
    />
  ),
}));

const AT = '2026-10-01T00:00:00.000Z';
const ref = {
  courseId: 'course-1',
  moduleId: 'module-1',
  createdAt: AT,
  updatedAt: AT,
};

const item = (contentItemId: string, type: string, title: string) => ({
  ...ref,
  lessonId: 'lesson-1',
  contentItemId,
  type,
  status: 'ready',
  title,
  order: 1,
  ...(type === 'video' && {
    s3Key: 'courses/course-1/video/nonce/master.m3u8',
    mimeType: 'application/vnd.apple.mpegurl',
  }),
  ...(type === 'text' && { body: '{"type":"doc","content":[]}' }),
});

const course = () => ({
  courseId: 'course-1',
  title: 'Course',
  status: 'published',
  createdAt: AT,
  updatedAt: AT,
  modules: [
    {
      ...ref,
      title: 'Unit 1',
      order: 1,
      lessons: [
        {
          ...ref,
          lessonId: 'lesson-1',
          title: 'Lecture 1',
          order: 1,
          contentItems: [
            item('video-1', 'video', 'First video'),
            item('video-2', 'video', 'Second video'),
            item('text-1', 'text', 'Notes'),
          ],
        },
      ],
    },
  ],
});

const handlers = {
  'course.view': () => course(),
  'course.myItemCompletions': () => ({ items: [] }),
  'course.myLessonProgress': () => ({ lessons: [] }),
  'course.myEnrolment': () => ({
    courseId: 'course-1',
    userId: 'student-1',
    status: 'active',
    progressPercent: 0,
    createdAt: AT,
    updatedAt: AT,
  }),
  'announcement.list': () => ({ items: [] }),
  'contentItem.videoUrl': () => ({
    url: 'https://media.example.com/master.m3u8',
    withCredentials: false,
    versionId: 'nonce',
    resumeAt: 30,
    captions: [],
  }),
  'discussion.listQuestions': () => ({ items: [] }),
};

const open = (props: { item?: string; t?: number }) =>
  renderWithCoreApi(
    <LessonPage courseId="course-1" lessonId="lesson-1" {...props} />,
    { handlers },
  );

const startAt = async (title: string) =>
  (await screen.findByTestId(`player-${title}`)).getAttribute('data-start-at');

const scrollIntoView = vi.fn();
Element.prototype.scrollIntoView = scrollIntoView;

afterEach(() => {
  cleanup();
  scrollIntoView.mockClear();
});

describe('opening a lesson at a moment', () => {
  it('gives that video startAt and the lesson’s other video none', async () => {
    open({ item: 'video-1', t: 760 });

    expect(await startAt('First video')).toBe('760');
    expect(await startAt('Second video')).toBe('none');
  });

  it('always offers the transcript', async () => {
    open({});

    expect(
      (await screen.findByTestId('player-First video')).getAttribute(
        'data-transcript',
      ),
    ).toBe('true');
  });

  it('scrolls to the video and moves focus to it', async () => {
    open({ item: 'video-2', t: 5 });

    const article = await screen.findByRole('article', {
      name: 'Second video',
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(article));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an unknown item', { item: 'nope', t: 760 }],
    ['a non-video item', { item: 'text-1', t: 760 }],
    ['no item', { t: 760 }],
  ])('ignores %s', async (_, props) => {
    open(props);

    expect(await startAt('First video')).toBe('none');
    expect(await startAt('Second video')).toBe('none');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('opens the video with no time when only the item is given', async () => {
    open({ item: 'video-1' });

    expect(await startAt('First video')).toBe('none');
  });
});
