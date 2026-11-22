/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  renderWithCoreApi,
} from '../../../../test/render-with-core-api';
import { FreePreviewItem } from './free-preview-item';

// The player itself is covered in common-shadcn; here it only shows what it got,
// and counts how often it was mounted.
const mounted = vi.hoisted(() => ({ count: 0 }));
vi.mock('@discava/common-shadcn/components/hls-video', async () => {
  const { useEffect } = await import('react');
  const { captionMenuLabel } = await import(
    '@discava/common-shadcn/components/video-controls'
  );
  return {
    HlsVideo: ({
      url,
      autoPlay,
      captions = [],
    }: {
      url: string;
      autoPlay?: boolean;
      captions?: { label: string; machineTranslated?: boolean }[];
    }) => {
      useEffect(() => {
        mounted.count += 1;
      }, []);
      return (
        <div data-testid="player" data-autoplay={String(autoPlay)}>
          {url}
          <ul>
            {captions.map((c) => (
              <li key={c.label}>{captionMenuLabel(c)}</li>
            ))}
          </ul>
        </div>
      );
    },
  };
});

const lesson = { courseId: 'c1', moduleId: 'm1', lessonId: 'l1' };
const videoUrl = {
  url: 'https://media.test/v/master.m3u8',
  withCredentials: true,
  versionId: 'v1',
  captions: [],
};
const FORBIDDEN_CALLS = [
  'contentItem.videoUrl',
  'contentItem.fileUrl',
  'contentItem.saveVideoPosition',
  'contentItem.complete',
  'quiz.view',
];

const video = (playable: boolean) => ({
  type: 'video' as const,
  contentItemId: 'i-video',
  title: 'Intro video',
  playable,
});
const file = {
  type: 'file' as const,
  contentItemId: 'i-file',
  title: 'Slides',
  fileName: 'slides.pdf',
  fileSize: 2048,
  mimeType: 'application/pdf',
};

const renderItem = (
  item: Parameters<typeof FreePreviewItem>[0]['item'],
  handlers: Record<string, () => unknown> = {},
) =>
  renderWithCoreApi(<FreePreviewItem item={item} lesson={lesson} />, {
    signedIn: false,
    handlers,
  });

afterEach(() => {
  vi.useRealTimers();
  mounted.count = 0;
});

describe('FreePreviewItem', () => {
  it('shows a playable video as a poster, and asks for it only on Play', async () => {
    const { calls, user } = renderItem(video(true), {
      'freePreview.videoUrl': () => videoUrl,
    });

    const play = await screen.findByRole('button', { name: 'Play' });
    expect(play).not.toHaveTextContent('→');
    expect(play.querySelector('svg')).toBeNull();
    expect(calls.map((c) => c.path)).not.toContain('freePreview.videoUrl');

    await user.click(play);

    const player = await screen.findByTestId('player');
    expect(player).toHaveTextContent(videoUrl.url);
    expect(player).toHaveAttribute('data-autoplay', 'true');
    expect(calls.map((c) => c.path)).toEqual(['freePreview.videoUrl']);
    expect(calls[0].input).toMatchObject({
      ...lesson,
      contentItemId: 'i-video',
    });
  });

  it('hands the player a translated track marked as auto-translated', async () => {
    const { user } = renderItem(video(true), {
      'freePreview.videoUrl': () => ({
        ...videoUrl,
        captions: [
          {
            trackId: 't1',
            language: 'en-US',
            label: 'English',
            isDefault: true,
            machineTranslated: false,
            url: 'https://media.test/v/t1.vtt',
          },
          {
            trackId: 't2',
            language: 'es-ES',
            label: 'Español',
            isDefault: false,
            machineTranslated: true,
            url: 'https://media.test/v/t2.vtt',
          },
        ],
      }),
    });

    await user.click(await screen.findByRole('button', { name: 'Play' }));

    expect(await screen.findByText('Español (auto-translated)')).toBeVisible();
    expect(screen.getByText('English')).toBeVisible();
  });

  it('says a video that is not playable is being prepared', async () => {
    const { calls } = renderItem(video(false));

    expect(
      await screen.findByText('This video is being prepared.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('shows "This video is not available" when the address is refused', async () => {
    const { user } = renderItem(video(true), {
      'freePreview.videoUrl': () => {
        throw new ApiError('NOT_FOUND', 'This preview is not available');
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Play' }));

    expect(
      await screen.findByText('This video is not available'),
    ).toBeInTheDocument();
  });

  it('refetches the address every 30 minutes without remounting the player', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { calls, user } = renderItem(video(true), {
      'freePreview.videoUrl': () => videoUrl,
    });

    await user.click(await screen.findByRole('button', { name: 'Play' }));
    await screen.findByTestId('player');
    expect(calls).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1000);
    });

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(screen.getByTestId('player')).toHaveTextContent(videoUrl.url);
    expect(mounted.count).toBe(1);
  });

  it('shows text as text', async () => {
    renderItem({
      type: 'text',
      contentItemId: 'i-text',
      title: 'Reading',
      body: JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Plain words' }],
          },
        ],
      }),
    });

    expect(
      await screen.findByRole('heading', { name: 'Reading' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Plain words')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a file with Download, and asks for the link only then', async () => {
    const location = window.location;
    const assign = { href: '' };
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: assign,
    });
    try {
      const { calls, user } = renderItem(file, {
        'freePreview.fileUrl': () => ({ url: 'https://media.test/f.pdf' }),
      });

      expect(await screen.findByText('slides.pdf')).toBeInTheDocument();
      expect(calls).toHaveLength(0);

      await user.click(screen.getByRole('button', { name: 'Download' }));

      await waitFor(() => expect(assign.href).toBe('https://media.test/f.pdf'));
      expect(calls.map((c) => c.path)).toEqual(['freePreview.fileUrl']);
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: location,
      });
    }
  });

  it('shows a refused download as an error', async () => {
    const { user } = renderItem(file, {
      'freePreview.fileUrl': () => {
        throw new ApiError('NOT_FOUND', 'This preview is not available');
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Download' }));

    expect(
      await screen.findByText('This file is not available.'),
    ).toBeInTheDocument();
  });

  it('locks a quiz: its title and question count, and no button', async () => {
    const { calls } = renderItem({
      type: 'quiz',
      contentItemId: 'i-quiz',
      title: 'Check yourself',
      questionCount: 5,
    });

    expect(await screen.findByText('Check yourself')).toBeInTheDocument();
    expect(screen.getByText('5 questions')).toBeInTheDocument();
    expect(screen.getByText('Enrol to take this quiz')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('never calls an operation that records progress or needs an enrolment', async () => {
    const { calls, user } = renderItem(video(true), {
      'freePreview.videoUrl': () => videoUrl,
    });
    await user.click(await screen.findByRole('button', { name: 'Play' }));
    await screen.findByTestId('player');

    for (const path of FORBIDDEN_CALLS) {
      expect(calls.map((c) => c.path)).not.toContain(path);
    }
    expect(screen.queryByText('Mark as done')).toBeNull();
  });
});
