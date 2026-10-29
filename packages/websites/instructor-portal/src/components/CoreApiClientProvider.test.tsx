/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useCoreApi } from '../hooks/useCoreApi';
import { RuntimeConfigContext } from './RuntimeConfig';

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { access_token: 'the-access-token' } }),
}));

const { CoreApiClientProvider } = await import('./CoreApiClientProvider');

describe('useCoreApi', () => {
  it('throws outside CoreApiClientProvider', () => {
    expect(() => renderHook(() => useCoreApi())).toThrow(
      'useCoreApi must be used within CoreApiClientProvider',
    );
  });
});

describe('CoreApiClientProvider', () => {
  it("builds a client that calls the runtime config's CoreApi URL, authorized as the signed-in user", async () => {
    const fetchMock = vi.fn(
      () =>
        new Response(JSON.stringify({ result: { data: null } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const queryClient = new QueryClient();

    function Caller() {
      const trpc = useCoreApi();
      useEffect(() => {
        void queryClient.fetchQuery(
          trpc.course.publicList.queryOptions({ limit: 10 }),
        );
      }, [trpc]);
      return null;
    }

    render(
      <RuntimeConfigContext.Provider
        value={{ apis: { CoreApi: 'https://core-api.example/' } }}
      >
        <QueryClientProvider client={queryClient}>
          <CoreApiClientProvider>
            <Caller />
          </CoreApiClientProvider>
        </QueryClientProvider>
      </RuntimeConfigContext.Provider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('https://core-api.example/');
    expect(new Headers(options?.headers).get('authorization')).toBe(
      'Bearer the-access-token',
    );

    vi.unstubAllGlobals();
  });
});
