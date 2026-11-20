/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { lockAgentIssue, numberFromUrl } from './conversation-lock.js';

const fakeGh = (refuse: string[] = []) => {
  const calls: string[][] = [];
  const gh = (args: string[]) => {
    calls.push(args);
    if (args.includes('PUT') && refuse.some((p) => args[3].includes(p))) {
      throw new Error('HTTP 403');
    }
    return args.includes('.locked') ? 'false' : '';
  };
  return { calls, gh };
};

describe('numberFromUrl', () => {
  it('reads issue and pull request URLs', () => {
    expect(numberFromUrl('https://github.com/o/r/issues/12\n')).toBe('12');
    expect(numberFromUrl('https://github.com/o/r/pull/9')).toBe('9');
    expect(numberFromUrl('nope')).toBeUndefined();
  });
});

describe('lockAgentIssue', () => {
  it('locks the issue and what it points at', () => {
    const { calls, gh } = fakeGh();
    expect(
      lockAgentIssue({
        repository: 'o/r',
        issueUrl: 'https://github.com/o/r/issues/12',
        label: 'openhands',
        alsoLock: [5],
        gh,
        log: () => {},
      }),
    ).toBe(true);
    expect(
      calls.filter((args) => args.includes('PUT') || args[1] === 'edit'),
    ).toEqual([
      ['api', '-X', 'PUT', 'repos/o/r/issues/12/lock'],
      ['api', '-X', 'PUT', 'repos/o/r/issues/5/lock'],
      ['issue', 'edit', '12', '--add-label', 'openhands'],
    ]);
  });

  it('never adds the label when something could not be locked', () => {
    const { calls, gh } = fakeGh(['/issues/5/']);
    const logs: string[] = [];
    expect(
      lockAgentIssue({
        repository: 'o/r',
        issueUrl: 'https://github.com/o/r/issues/12',
        label: 'openhands',
        alsoLock: [5],
        gh,
        log: (m) => logs.push(m),
      }),
    ).toBe(false);
    expect(calls.some((args) => args[1] === 'edit')).toBe(false);
    expect(logs[0]).toContain('::warning::');
  });
});
