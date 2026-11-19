/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Test-only helpers shared by the portals and common-shadcn: tests and test
// setup files import this (`@discava/common-web-utils/testing`), portal source
// never does.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type RenderResult, render } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { createTRPCClient, httpLink, type TRPCClient } from '@trpc/client';
import type { AnyTRPCRouter } from '@trpc/server';
import {
  createTRPCOptionsProxy,
  type TRPCOptionsProxy,
} from '@trpc/tanstack-react-query';
import { type Context, createElement, type ReactElement } from 'react';
import { RuntimeConfigContext } from './runtime-config';
import type { TrpcContextValue } from './trpc-provider';

// What a handler throws to make a procedure fail, as the API would with
// TRPCError({ code, message }).
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const HTTP_STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  INTERNAL_SERVER_ERROR: 500,
};

// A procedure's stand-in: gets the input, returns the output or throws.
export type Handler = (input: unknown) => unknown;

export interface ApiCall {
  path: string;
  input: unknown;
}

// Answers a portal's real tRPC client the way an API does over HTTP (no
// batching, no transformer: GET ?input= for queries, a JSON body for
// mutations), so components run with their real hooks and client, against
// whichever API the caller built `client` for.
export const fakeTrpcFetch =
  (handlers: Record<string, Handler>, calls: ApiCall[]) =>
  async (url: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const { pathname, searchParams } = new URL(String(url));
    const path = pathname.replace(/^\//, '');
    const rawInput =
      init?.method === 'POST' ? init.body : searchParams.get('input');
    const input =
      typeof rawInput === 'string' && rawInput
        ? JSON.parse(rawInput)
        : undefined;
    calls.push({ path, input });
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    const handler = handlers[path];
    if (!handler) {
      return json(
        {
          error: {
            message: `No handler for ${path}`,
            code: -32004,
            data: { code: 'NOT_FOUND', httpStatus: 404, path },
          },
        },
        404,
      );
    }
    try {
      return json({ result: { data: (await handler(input)) ?? null } });
    } catch (error) {
      const code =
        error instanceof ApiError ? error.code : 'INTERNAL_SERVER_ERROR';
      const httpStatus = HTTP_STATUS[code] ?? 500;
      return json(
        {
          error: {
            message: (error as Error).message,
            code: -32000,
            data: { code, httpStatus, path },
          },
        },
        httpStatus,
      );
    }
  };

// Where public media (course images) is served from in tests.
export const PUBLIC_MEDIA_URL = 'https://media.test/';

// What renderWith*Api returns: every call the component made, the query
// client, the options proxy and a user-event instance for interacting.
export interface RenderedWithApi<TRouter extends AnyTRPCRouter>
  extends RenderResult {
  calls: ApiCall[];
  queryClient: QueryClient;
  optionsProxy: TRPCOptionsProxy<TRouter>;
  user: UserEvent;
}

// What createRenderWithApi builds. Portals annotate their renderWith*Api with
// it, so the declaration emit doesn't have to name the API router's inferred
// types.
export type RenderWithApi<TRouter extends AnyTRPCRouter> = (
  ui: ReactElement,
  options?: {
    handlers?: Record<string, Handler>;
    // Merged into the runtime config the portal sees.
    runtimeConfig?: Record<string, unknown>;
  },
) => RenderedWithApi<TRouter>;

// Builds a portal's renderWith*Api for the API behind `Context` (the context
// its `createTrpcProvider` returned). The result renders `ui` inside a fresh
// React Query client and an API whose procedures are answered by `handlers`
// (keyed by path, e.g. 'course.publish').
export const createRenderWithApi =
  <TRouter extends AnyTRPCRouter>(
    Context: Context<TrpcContextValue<TRouter> | null>,
  ): RenderWithApi<TRouter> =>
  (
    ui: ReactElement,
    {
      handlers = {},
      runtimeConfig = {},
    }: {
      handlers?: Record<string, Handler>;
      // Merged into the runtime config the portal sees.
      runtimeConfig?: Record<string, unknown>;
    } = {},
  ): RenderedWithApi<TRouter> => {
    const calls: ApiCall[] = [];
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    // The link is built for any router: with a generic one, tRPC can't tell
    // whether the router needs a transformer, so the client is cast back.
    const client = createTRPCClient<AnyTRPCRouter>({
      links: [
        httpLink({
          url: 'http://api.test/',
          fetch: fakeTrpcFetch(handlers, calls),
        }),
      ],
    }) as unknown as TRPCClient<TRouter>;
    const optionsProxy = createTRPCOptionsProxy<TRouter>({
      client,
      queryClient,
    });
    const user = userEvent.setup();
    const result = render(
      createElement(
        RuntimeConfigContext.Provider,
        {
          value: {
            media: { PublicMediaBucket: PUBLIC_MEDIA_URL },
            ...runtimeConfig,
          },
        },
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(
            Context.Provider,
            { value: { client, optionsProxy } },
            ui,
          ),
        ),
      ),
    );
    return { ...result, calls, queryClient, optionsProxy, user };
  };

// Stubs for what jsdom doesn't implement, which the portals' components need.
// Each is only set when jsdom lacks it.
export const installJsdomStubs = (): void => {
  // Radix components and dnd-kit track element sizes with it. Layout isn't
  // computed in jsdom anyway, so observing nothing is enough.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??=
    ResizeObserverStub as unknown as typeof ResizeObserver;

  // Radix Select captures the pointer and scrolls the chosen item into view.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};

  // The sidebar uses matchMedia to tell phones apart. Report a desktop-sized
  // window that never changes.
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;

  // The signed-in home's carousel uses it; nothing ever scrolls into view in
  // jsdom, so it never reports.
  class IntersectionObserverStub {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  globalThis.IntersectionObserver ??=
    IntersectionObserverStub as unknown as typeof IntersectionObserver;

  // ProseMirror (the rich text editor's engine) measures the caret's screen
  // position to scroll it into view and to map clicks to a document position,
  // which needs layout that jsdom doesn't compute.
  document.elementFromPoint ??= () => null;
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
};

// For a router mock: keeps the real @tanstack/react-router (so `createRouter`
// and friends still work) and replaces only `overrides`, e.g. `Link` and
// `useNavigate`, which need a router context that component tests don't set
// up. Import it inside the factory, which vi.mock hoists above the imports:
//   vi.mock('@tanstack/react-router', async (importOriginal) => {
//     const { mockRouter } = await import('@discava/common-web-utils/testing');
//     return mockRouter(importOriginal, { useNavigate: () => navigate });
//   });
export const mockRouter = async (
  importOriginal: () => Promise<Record<string, unknown>>,
  overrides: Record<string, unknown>,
) => ({ ...(await importOriginal()), ...overrides });
