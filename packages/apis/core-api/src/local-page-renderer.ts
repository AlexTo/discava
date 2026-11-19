/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createServer } from 'node:http';
import { LOCAL_PAGE_RENDERER_URL } from '@discava/common-server-utils/local-dev';
import {
  createConfiguredPageRenderer,
  type PageRendererEvent,
} from './page-renderer/handler.js';

const PORT = Number(new URL(LOCAL_PAGE_RENDERER_URL).port);

const render = createConfiguredPageRenderer();

// The deployed Function URL, locally: the same handler over plain HTTP. The
// e2e reads crawler HTML from it; local dev is closed to search engines.
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', LOCAL_PAGE_RENDERER_URL);
  const event: PageRendererEvent = {
    rawPath: url.pathname,
    headers: Object.fromEntries(
      Object.entries(req.headers).flatMap(([name, value]) =>
        typeof value === 'string' ? [[name, value]] : [],
      ),
    ),
    requestContext: { http: { method: req.method ?? 'GET' } },
  };
  const response = await render(event);
  res.writeHead(response.statusCode, response.headers);
  res.end(response.body);
}).listen(PORT, () => {
  console.log(`Local page renderer listening on port ${PORT}`);
});
