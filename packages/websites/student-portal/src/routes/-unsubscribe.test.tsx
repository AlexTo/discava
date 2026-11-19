/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from '../routeTree.gen';
import { renderWithCoreApi } from '../test/render-with-core-api';

const API = 'http://core-api.test/';
const info = { type: 'assignment.graded', name: 'Graded work' };

type Reply = { status: number; body: unknown } | Error;

// Answers the page's fetches to the unsubscribe route in order, recording
// each request's URL and method.
const stubFetch = (...replies: Reply[]) => {
  const requests: { url: string; method: string }[] = [];
  const fetchMock = vi.fn(
    async (url: URL | RequestInfo, init?: RequestInit) => {
      requests.push({ url: String(url), method: init?.method ?? 'GET' });
      const reply = replies[Math.min(requests.length - 1, replies.length - 1)];
      if (reply instanceof Error) throw reply;
      return new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'content-type': 'application/json' },
      });
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return requests;
};

const open = (search: string) =>
  renderWithCoreApi(null, {
    routeTree,
    path: `/unsubscribe${search}`,
    signedIn: false,
    runtimeConfig: { apis: { CoreApi: API } },
    handlers: { 'course.publicList': () => ({ items: [] }) },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/unsubscribe', () => {
  it('only reads the link when opened, and offers to stop the emails', async () => {
    const requests = stubFetch({ status: 200, body: info });
    open('?token=abc.def');

    expect(
      await screen.findByRole('heading', { name: 'Stop Graded work emails?' }),
    ).toBeInTheDocument();
    expect(requests).toEqual([
      { url: `${API}unsubscribe/abc.def`, method: 'GET' },
    ]);
    expect(
      screen.getByRole('button', { name: 'Stop these emails' }),
    ).toBeInTheDocument();
  });

  it('switches the emails off with a POST when the button is pressed', async () => {
    const requests = stubFetch({ status: 200, body: info });
    const { user } = open('?token=abc.def');

    await user.click(
      await screen.findByRole('button', { name: 'Stop these emails' }),
    );

    expect(
      await screen.findByText("You won't get Graded work emails any more."),
    ).toBeInTheDocument();
    expect(requests[1]).toEqual({
      url: `${API}unsubscribe/abc.def`,
      method: 'POST',
    });
    expect(
      screen.getByRole('link', { name: 'Notification settings' }),
    ).toHaveAttribute('href', '/settings/notifications');
  });

  it('turns them back on with a POST carrying resubscribe=1', async () => {
    const requests = stubFetch({ status: 200, body: info });
    const { user } = open('?token=abc.def');
    await user.click(
      await screen.findByRole('button', { name: 'Stop these emails' }),
    );

    await user.click(
      await screen.findByRole('button', { name: 'Turn them back on' }),
    );

    expect(
      await screen.findByText('Graded work emails are back on.'),
    ).toBeInTheDocument();
    expect(requests[2]).toEqual({
      url: `${API}unsubscribe/abc.def?resubscribe=1`,
      method: 'POST',
    });
  });

  it('shows the invalid state, without a button, for a token the API rejects', async () => {
    stubFetch({ status: 404, body: { error: 'invalid' } });
    open('?token=tampered');

    expect(
      await screen.findByText('This link is not valid.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Stop these emails' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Go to the home page' }),
    ).toHaveAttribute('href', '/');
  });

  it('shows the invalid state without calling the API when there is no token', async () => {
    const requests = stubFetch({ status: 200, body: info });
    open('');

    expect(
      await screen.findByText('This link is not valid.'),
    ).toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it('shows an error with Try again when the API cannot be reached', async () => {
    const requests = stubFetch(new Error('offline'), {
      status: 200,
      body: info,
    });
    const { user } = open('?token=abc.def');

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByRole('heading', { name: 'Stop Graded work emails?' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(requests).toHaveLength(2));
  });

  it('works without signing in', async () => {
    stubFetch({ status: 200, body: info });
    open('?token=abc.def');

    expect(
      await screen.findByRole('button', { name: 'Stop these emails' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });
});
