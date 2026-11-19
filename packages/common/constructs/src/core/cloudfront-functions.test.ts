/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Request = { uri: string; headers: Record<string, { value: string }> };
type Handler = (event: { request: Request }) => Request;

// A CloudFront Function is one `handler`; load it the way the edge would.
const load = (file: string): Handler =>
  new Function(
    `${readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf-8')}\nreturn handler;`,
  )() as Handler;

describe('spa-rewrite.js', () => {
  const handler = load('./spa-rewrite.js');
  const rewrite = (uri: string) =>
    handler({ event: undefined, request: { uri, headers: {} } } as never).uri;

  it.each([
    ['/', '/index.html'],
    ['/learn/x', '/index.html'],
    ['/learn/x/lesson/y', '/index.html'],
    ['/assets/a.js', '/assets/a.js'],
    ['/runtime-config.json', '/runtime-config.json'],
    ['/foo.bar/baz', '/index.html'],
  ])('%s -> %s', (uri, expected) => {
    expect(rewrite(uri)).toBe(expected);
  });
});

describe('forward-host.js', () => {
  const handler = load('./forward-host.js');

  it('copies the viewer host into x-discava-host and keeps the path', () => {
    const request = handler({
      request: {
        uri: '/learn/x',
        headers: { host: { value: 'learn.example.com' } },
      },
    });
    expect(request.headers['x-discava-host']).toEqual({
      value: 'learn.example.com',
    });
    expect(request.uri).toBe('/learn/x');
  });

  it('adds nothing without a host', () => {
    const request = handler({ request: { uri: '/', headers: {} } });
    expect(request.headers['x-discava-host']).toBeUndefined();
  });
});
