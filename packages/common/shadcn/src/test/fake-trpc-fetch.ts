/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

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
// whichever API (instructor-api, core-api) the caller built `client` for.
export const fakeFetch =
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
