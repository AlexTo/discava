/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanEntityWriters, sortWriterMap } from './scan.js';

describe('scanEntityWriters', () => {
  it('finds each write and the entity it writes, however the entity is reached', () => {
    expect(
      scanEntityWriters({
        root: path.join(import.meta.dirname, 'fixture'),
        packages: { api: 'api', 'core-table': 'table' },
      }),
    ).toEqual({
      gadget: { api: ['api/src/destructured.ts'] },
      unused: {},
      widget: {
        api: ['api/src/direct.ts', 'api/src/transaction.ts'],
        'core-table': ['table/src/helpers/widget.ts'],
      },
    });
  }, 30_000);
});

describe('sortWriterMap', () => {
  it('orders entities, writers and files', () => {
    expect(
      JSON.stringify(sortWriterMap({ b: { y: ['2', '1'], x: [] }, a: {} })),
    ).toBe('{"a":{},"b":{"x":[],"y":["1","2"]}}');
  });
});
