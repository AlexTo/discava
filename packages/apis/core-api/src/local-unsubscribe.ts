/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  handleUnsubscribe,
  type UnsubscribeDeps,
} from '@discava/common-server-utils/unsubscribe';

const ROUTE = /^\/unsubscribe\/([^/?]+)$/;

/**
 * Local stand-in for the deployed `notification-unsubscribe` function: serves
 * `GET`/`POST /unsubscribe/:token` with the same `handleUnsubscribe`, and
 * passes every other request on. `allowedOrigin` is the student portal's.
 */
export const unsubscribeMiddleware =
  (getDeps: () => Promise<UnsubscribeDeps>, allowedOrigin: string) =>
  (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = ROUTE.exec(url.pathname);
    if (!match) {
      next();
      return;
    }
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end(JSON.stringify(body));
    };
    const method = req.method ?? 'GET';
    if (method === 'OPTIONS') {
      send(204, undefined);
      return;
    }
    // The body is ignored (JSON, or `List-Unsubscribe=One-Click`), but drain it.
    req.resume();
    getDeps()
      .then((deps) =>
        handleUnsubscribe(
          {
            method,
            token: decodeURIComponent(match[1]),
            query: Object.fromEntries(url.searchParams),
          },
          deps,
        ),
      )
      .then(({ status, body }) => send(status, body))
      .catch((error) => {
        console.error('Unsubscribe failed', error);
        send(500, { error: 'internal' });
      });
  };
