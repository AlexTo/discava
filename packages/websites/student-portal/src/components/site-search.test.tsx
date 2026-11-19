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
  const box = screen.getByRole('combobox', { name: 'Search courses' });
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
      screen.getByRole('option', { name: 'Python for Data Analysis' }),
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
      screen.getByRole('option', { name: 'JavaScript Deep Dive' }),
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
    fireEvent.click(screen.getByRole('option', { name: 'Python Basics' }));
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

    expect(screen.getAllByRole('option')).toHaveLength(10);
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

  describe('keyboard and screen reader', () => {
    const three = () => ({
      items: [
        course('c1', 'Python Basics'),
        course('c2', 'Python Advanced'),
        course('c3', 'Python Web'),
      ],
    });
    const key = (box: HTMLElement, name: string) =>
      fireEvent.keyDown(box, { key: name });
    const openThree = async () => {
      const opened = await open(three);
      await opened.type('python');
      await advance(300);
      await advance(50);
      return opened;
    };

    it('follows the combobox pattern', async () => {
      const { box, type } = await open(three);
      expect(box).toHaveAttribute('aria-expanded', 'false');
      expect(box).toHaveAttribute('aria-autocomplete', 'list');

      await type('python');
      await advance(300);
      await advance(50);

      const list = screen.getByRole('listbox', { name: 'Course suggestions' });
      expect(box).toHaveAttribute('aria-expanded', 'true');
      expect(box).toHaveAttribute('aria-controls', list.id);
      expect(screen.getAllByRole('option')).toHaveLength(3);
      expect(box).not.toHaveAttribute('aria-activedescendant');
    });

    it('moves the highlight with Down and Up, wrapping, keeping the text', async () => {
      const { box } = await openThree();
      const options = screen.getAllByRole('option');

      key(box, 'ArrowDown');
      expect(box).toHaveAttribute('aria-activedescendant', options[0].id);
      expect(options[0]).toHaveAttribute('aria-selected', 'true');
      key(box, 'ArrowUp');
      expect(box).toHaveAttribute('aria-activedescendant', options[2].id);
      key(box, 'ArrowDown');
      expect(box).toHaveAttribute('aria-activedescendant', options[0].id);
      expect(box).toHaveValue('python');
    });

    it('chooses the highlighted row on Enter', async () => {
      const { box, router } = await openThree();

      key(box, 'ArrowDown');
      key(box, 'ArrowDown');
      key(box, 'Enter');
      await advance(0);

      expect(router.state.location.pathname).toBe('/learn/c2');
    });

    it('closes on Escape and keeps the text', async () => {
      const { box } = await openThree();

      key(box, 'Escape');

      expect(
        screen.queryByRole('listbox', { name: 'Course suggestions' }),
      ).not.toBeInTheDocument();
      expect(box).toHaveAttribute('aria-expanded', 'false');
      expect(box).toHaveValue('python');
    });

    it('closes when focus leaves', async () => {
      const { box } = await openThree();

      fireEvent.blur(box);

      expect(
        screen.queryByRole('listbox', { name: 'Course suggestions' }),
      ).not.toBeInTheDocument();
    });

    it('resets the highlight when the answer changes', async () => {
      const { box, type } = await open((input) => ({
        items: [
          course(`${(input as { q: string }).q}-1`, 'Python Basics'),
          course(`${(input as { q: string }).q}-2`, 'Python Web'),
        ],
      }));
      await type('python');
      await advance(350);
      key(box, 'ArrowDown');
      await type('pythons');
      await advance(350);

      expect(box).not.toHaveAttribute('aria-activedescendant');
    });

    it('drops the highlight when the text is edited, so Enter submits', async () => {
      const { box, router, type } = await openThree();

      key(box, 'ArrowDown');
      await type('python pandas');
      expect(box).not.toHaveAttribute('aria-activedescendant');
      key(box, 'Enter');
      fireEvent.submit(box.closest('form') as HTMLFormElement);
      await advance(0);

      expect(router.state.location.pathname).toBe('/search');
      expect(router.state.location.search).toEqual({
        query: 'python pandas',
      });
    });

    it('announces the count of suggestions', async () => {
      await openThree();

      expect(screen.getByRole('status')).toHaveTextContent('3 suggestions');
    });

    it('announces when no course matches', async () => {
      const { type } = await open();
      await type('zzzzz');
      await advance(300);
      await advance(50);

      expect(screen.getByRole('status')).toHaveTextContent('No courses match');
    });
  });
});
