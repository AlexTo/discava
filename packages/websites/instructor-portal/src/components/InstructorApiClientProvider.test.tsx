/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useInstructorApi } from '../hooks/useInstructorApi';
import { RuntimeConfigContext } from './RuntimeConfig';

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { access_token: 'the-access-token' } }),
}));

const { InstructorApiClientProvider } = await import(
  './InstructorApiClientProvider'
);

describe('useInstructorApi', () => {
  it('throws outside InstructorApiClientProvider', () => {
    expect(() => renderHook(() => useInstructorApi())).toThrow(
      'useInstructorApi must be used within InstructorApiClientProvider',
    );
  });
});

describe('InstructorApiClientProvider', () => {
  it("builds a client that calls the runtime config's InstructorApi URL, authorized as the signed-in user", async () => {
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
      const trpc = useInstructorApi();
      useEffect(() => {
        void queryClient.fetchQuery(
          trpc.course.view.queryOptions({ courseId: 'c1' }),
        );
      }, [trpc]);
      return null;
    }

    render(
      <RuntimeConfigContext.Provider
        value={{ apis: { InstructorApi: 'https://instructor-api.example/' } }}
      >
        <QueryClientProvider client={queryClient}>
          <InstructorApiClientProvider>
            <Caller />
          </InstructorApiClientProvider>
        </QueryClientProvider>
      </RuntimeConfigContext.Provider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('https://instructor-api.example/');
    expect(new Headers(options?.headers).get('authorization')).toBe(
      'Bearer the-access-token',
    );

    vi.unstubAllGlobals();
  });
});
