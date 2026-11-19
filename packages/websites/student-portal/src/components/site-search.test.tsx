/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type Handler,
  renderWithCoreApi,
} from '../test/render-with-core-api';
import { SiteSearch } from './site-search';

const course = (courseId: string, title: string, imageKey?: string) => ({
  courseId,
  title,
  ...(imageKey && { imageKey }),
});

const suggestPath = 'course.publicSuggest';

// Lets pending promises (the router, fetches, state updates) run, then
// advances fake time.
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const suggestCalls = (calls: { path: string }[]) =>
  calls.filter(({ path }) => path === suggestPath);

const open = async (handler: Handler = () => ({ items: [] }), path = '/') => {
  const rendered = renderWithCoreApi(<SiteSearch />, {
    signedIn: false,
    path,
    handlers: { [suggestPath]: handler },
  });
  await advance(0);
  const box = screen.getByRole('searchbox', { name: 'Search courses' });
  const type = async (text: string) => {
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: text } });
    await advance(0);
  };
  return { ...rendered, box, type };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SiteSearch suggestions', () => {
  it('sends no request for under 3 characters', async () => {
    const { calls, type } = await open();

    await type('py');
    await advance(1_000);

    expect(suggestCalls(calls)).toEqual([]);
  });

  it('sends one request 300 ms after 3 characters, and none before', async () => {
    const { calls, type } = await open(() => ({
      items: [course('c1', 'Python for Data Analysis')],
    }));

    await type('pyt');
    await advance(299);
    expect(suggestCalls(calls)).toEqual([]);
    await advance(1);
    await advance(0);

    expect(suggestCalls(calls)).toEqual([
      { path: suggestPath, input: { q: 'pyt' } },
    ]);
    expect(
      screen.getByRole('button', { name: 'Python for Data Analysis' }),
    ).toBeInTheDocument();
  });

  it('sends one request for a word typed one key at a time', async () => {
    const { calls, type } = await open(() => ({ items: [] }));

    for (let length = 1; length <= 'javascript'.length; length++) {
      await type('javascript'.slice(0, length));
      await advance(50);
    }
    await advance(1_000);

    expect(suggestCalls(calls)).toEqual([
      { path: suggestPath, input: { q: 'javascript' } },
    ]);
  });

  it('keeps the newest answer when an older one arrives later', async () => {
    let answerJavas: (value: unknown) => void = () => {};
    const { type } = await open((input) => {
      const { q } = input as { q: string };
      return q === 'javas'
        ? new Promise((resolve) => {
            answerJavas = resolve;
          })
        : { items: [course('c2', 'JavaScript Deep Dive')] };
    });

    await type('javas');
    await advance(300);
    await type('javascript');
    await advance(300);
    await advance(50);
    answerJavas({ items: [course('c1', 'Java Basics')] });
    await advance(50);

    expect(
      screen.getByRole('button', { name: 'JavaScript Deep Dive' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Java Basics')).not.toBeInTheDocument();
  });

  it('reuses a recent answer instead of asking again', async () => {
    const { calls, type } = await open(() => ({
      items: [course('c1', 'Python Basics')],
    }));

    await type('python');
    await advance(300);
    await type('pytho');
    await advance(300);
    await type('python');
    await advance(300);
    await advance(50);

    expect(suggestCalls(calls).map(({ input }) => input)).toEqual([
      { q: 'python' },
      { q: 'pytho' },
    ]);
  });

  it('opens the course when a suggestion is clicked', async () => {
    const { router, type } = await open(() => ({
      items: [course('c1', 'Python Basics')],
    }));

    await type('python');
    await advance(300);
    await advance(50);
    fireEvent.click(screen.getByRole('button', { name: 'Python Basics' }));
    await advance(0);

    expect(router.state.location.pathname).toBe('/learn/c1');
    expect(
      screen.queryByTestId('site-search-suggestions'),
    ).not.toBeInTheDocument();
  });

  it('opens the results on Enter before the pause ends, with no request', async () => {
    const { box, calls, router, type } = await open();

    await type('python');
    await advance(100);
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    await advance(1_000);

    expect(router.state.location.pathname).toBe('/search');
    expect(router.state.location.search).toEqual({ query: 'python' });
    expect(suggestCalls(calls)).toEqual([]);
  });

  it('shows no error and still submits when the suggestions fail', async () => {
    const { box, router, type } = await open(() => {
      throw new ApiError(
        'TIMEOUT',
        'Search is starting up. Try again in a few seconds.',
      );
    });

    await type('python');
    await advance(300);
    await advance(50);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('site-search-suggestions'),
    ).not.toBeInTheDocument();
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    await advance(0);

    expect(router.state.location.search).toEqual({ query: 'python' });
  });

  it('starts closed on the results page, with the query in the box', async () => {
    const { box, calls } = await open(
      () => ({ items: [course('c1', 'Linear Algebra')] }),
      '/search?query=linear',
    );
    await advance(1_000);

    expect(box).toHaveValue('linear');
    expect(
      screen.queryByTestId('site-search-suggestions'),
    ).not.toBeInTheDocument();
    expect(suggestCalls(calls)).toEqual([]);
  });

  it('shows up to 10 suggestions', async () => {
    const { type } = await open(() => ({
      items: Array.from({ length: 10 }, (_, i) =>
        course(`c${i}`, `Python ${i}`),
      ),
    }));

    await type('python');
    await advance(300);
    await advance(50);

    expect(screen.getAllByRole('button')).toHaveLength(10);
  });

  it('closes when the text drops under 3 characters', async () => {
    const { type } = await open(() => ({
      items: [course('c1', 'Python Basics')],
    }));

    await type('python');
    await advance(300);
    await advance(50);
    await type('py');

    expect(
      screen.queryByTestId('site-search-suggestions'),
    ).not.toBeInTheDocument();
  });

  it('sends no request for more than 200 characters', async () => {
    const { calls, type } = await open();

    await type('a'.repeat(201));
    await advance(1_000);

    expect(suggestCalls(calls)).toEqual([]);
  });
});
