/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { decide } from './gate.js';

const pr = (overrides: Partial<Parameters<typeof decide>[0]> = {}) => ({
  merged: true,
  labels: [],
  headRef: 'feature/x',
  ...overrides,
});

describe('decide', () => {
  it('ignores a pull request that was closed without merging', () => {
    expect(decide(pr({ merged: false, labels: ['spec-ready'] })).kind).toBe(
      'ignore',
    );
  });

  it('starts from a merged pull request labelled spec-ready', () => {
    expect(decide(pr({ labels: ['spec-ready', 'docs'] }))).toEqual({
      kind: 'spec',
    });
  });

  it('ignores an ordinary merged pull request, even one that touches specs', () => {
    expect(decide(pr({ labels: ['docs'] })).kind).toBe('ignore');
    expect(decide(pr()).kind).toBe('ignore');
  });

  it('chains from a merged agent pull request', () => {
    expect(decide(pr({ headRef: 'openhands/issue-42' }))).toEqual({
      kind: 'implementation',
    });
  });

  it('treats an agent branch as implementation even with the label', () => {
    expect(
      decide(pr({ headRef: 'openhands/issue-42', labels: ['spec-ready'] })),
    ).toEqual({ kind: 'implementation' });
  });
});
