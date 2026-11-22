/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  loadPreferences,
  savePreferences,
} from '@discava/common-web-utils/video-player';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ApiError,
  renderWithCoreApi,
} from '../../../../test/render-with-core-api';
import { TranscriptSearchResults } from './transcript-search-results';

const moment = (n: number, overrides: Record<string, unknown> = {}) => ({
  moduleId: 'module-2',
  moduleTitle: 'Module 2: Optimisation',
  lessonId: `lesson-${n}`,
  lessonTitle: `Gradient descent ${n}`,
  contentItemId: `video-${n}`,
  itemTitle: 'Lecture video',
  startSeconds: 760 + n,
  language: 'en',
  snippet: [
    { text: '…so the idea behind ', match: false },
    { text: 'gradient descent', match: true },
    { text: ' is that we step…', match: false },
  ],
  ...overrides,
});

const answer = (count: number, hasMore = false) => ({
  items: Array.from({ length: count }, (_, i) => moment(i + 1)),
  hasMore,
});

const setup = (handler: () => unknown, q = 'gradient descent') =>
  renderWithCoreApi(<TranscriptSearchResults courseId="course-1" q={q} />, {
    handlers: { 'transcript.search': handler },
  });

afterEach(() => localStorage.clear());

describe('TranscriptSearchResults', () => {
  it('lists each moment with titles, time and marked text', async () => {
    setup(() => answer(3));

    expect(
      await screen.findByRole('heading', {
        name: "Moments matching 'gradient descent'",
      }),
    ).toBeInTheDocument();
    const links = await screen.findAllByRole('link');
    expect(links).toHaveLength(3);
    const first = links[0]!;
    expect(first).toHaveAttribute(
      'href',
      '/learn/course-1/lesson/lesson-1?item=video-1&t=761',
    );
    expect(first).toHaveTextContent('Module 2: Optimisation');
    expect(first).toHaveTextContent('Gradient descent 1');
    expect(first).toHaveTextContent('Lecture video');
    expect(first).toHaveTextContent('12:41');
    expect(first).toHaveTextContent('12 minutes 41 seconds');
    expect(within(first).getByText('gradient descent').tagName).toBe('MARK');
  });

  it('reads lesson, video, time, then text in the link name', async () => {
    setup(() => answer(1));

    const link = await screen.findByRole('link');
    const name = link.textContent ?? '';
    const order = [
      'Gradient descent 1',
      'Lecture video',
      '12 minutes 41 seconds',
      'the idea behind',
    ].map((part) => name.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('hints at narrowing when there are more', async () => {
    setup(() => answer(20, true));

    expect(
      await screen.findByText(
        'Showing the 20 best matches. Add a word to narrow the search.',
      ),
    ).toBeInTheDocument();
  });

  it('says nothing matches', async () => {
    setup(() => answer(0));

    expect(
      await screen.findByText(/No moments match 'gradient descent'/),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No moments match');
  });

  it('announces the count', async () => {
    setup(() => answer(3));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('3 moments found'),
    );
  });

  it('announces Searching… while loading', async () => {
    setup(() => new Promise(() => {}));

    expect(await screen.findByText('Searching…')).toHaveAttribute(
      'role',
      'status',
    );
  });

  it('shows the prompt, and makes no request, for under 2 characters', async () => {
    const { calls } = setup(() => answer(1), 'a');

    expect(
      await screen.findByText("Search what was said in this course's videos."),
    ).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('offers Try again after a timeout, which asks again', async () => {
    let attempts = 0;
    const { user, calls } = setup(() => {
      attempts += 1;
      if (attempts === 1) {
        throw new ApiError(
          'TIMEOUT',
          'Search is starting up. Try again in a few seconds.',
        );
      }
      return answer(1);
    });

    expect(
      await screen.findByText(
        'Search is starting up. Try again in a few seconds.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findAllByRole('link')).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it('shows any other error with Try again', async () => {
    setup(() => {
      throw new ApiError('INTERNAL_SERVER_ERROR', 'Boom');
    });

    expect(
      await screen.findByText(
        'Something went wrong on our side. Try again in a moment.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('sends the saved caption language', async () => {
    savePreferences({ ...loadPreferences(), captionLanguage: 'es' });
    const { calls } = setup(() => answer(0));

    await screen.findAllByText(/No moments match/);
    expect(calls[0]).toMatchObject({
      path: 'transcript.search',
      input: { courseId: 'course-1', q: 'gradient descent', language: 'es' },
    });
  });
});
