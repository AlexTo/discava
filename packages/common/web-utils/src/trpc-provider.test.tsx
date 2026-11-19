/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, waitFor } from '@testing-library/react';
import { initTRPC } from '@trpc/server';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeConfigContext } from './runtime-config';

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { access_token: 'the-access-token' } }),
}));

const { createTrpcProvider } = await import('./trpc-provider');

const t = initTRPC.create();
const router = t.router({ ping: t.procedure.query(() => 'pong') });
type TestRouter = typeof router;

const renderCaller = async (
  options: Parameters<typeof createTrpcProvider>[0],
) => {
  const fetchMock = vi.fn(
    (_url: URL | RequestInfo, _init?: RequestInit) =>
      new Response(JSON.stringify({ result: { data: null } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const { Provider, useApi } = createTrpcProvider<TestRouter>(options);
  const queryClient = new QueryClient();

  function Caller() {
    const trpc = useApi();
    useEffect(() => {
      void queryClient.fetchQuery(trpc.ping.queryOptions());
    }, [trpc]);
    return null;
  }

  render(
    <RuntimeConfigContext.Provider
      value={{ apis: { [options.apiKey]: 'https://api.example/' } }}
    >
      <QueryClientProvider client={queryClient}>
        <Provider>
          <Caller />
        </Provider>
      </QueryClientProvider>
    </RuntimeConfigContext.Provider>,
  );

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  return fetchMock.mock.calls[0];
};

describe('createTrpcProvider', () => {
  it('names the missing provider when a hook is used outside it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { useApi, useApiClient } = createTrpcProvider<TestRouter>({
      apiKey: 'CoreApi',
    });
    expect(() => renderHook(() => useApi())).toThrow(
      'useCoreApi must be used within CoreApiClientProvider',
    );
    expect(() => renderHook(() => useApiClient())).toThrow(
      'useCoreApiClient must be used within CoreApiClientProvider',
    );
  });

  it("builds a client that calls the runtime config's URL for the API key, authorized as the signed-in user", async () => {
    const [url, options] = await renderCaller({ apiKey: 'InstructorApi' });
    expect(String(url)).toContain('https://api.example/');
    expect(new Headers(options?.headers).get('authorization')).toBe(
      'Bearer the-access-token',
    );
    expect(options?.credentials).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('sends the credentials option with every request when set', async () => {
    const [, options] = await renderCaller({
      apiKey: 'CoreApi',
      credentials: 'include',
    });
    expect(options?.credentials).toBe('include');
    vi.unstubAllGlobals();
  });
});
