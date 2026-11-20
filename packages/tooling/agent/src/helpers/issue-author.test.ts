/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { isTrustedIssue } from './issue-author.js';

describe('isTrustedIssue', () => {
  const issue = (author: string, association: string) => ({
    body: '<!-- marker -->',
    author,
    association,
  });

  it("trusts the workflow's own issues and those of people with write access", () => {
    expect(isTrustedIssue(issue('github-actions[bot]', 'NONE'))).toBe(true);
    expect(isTrustedIssue(issue('alice', 'OWNER'))).toBe(true);
    expect(isTrustedIssue(issue('bob', 'COLLABORATOR'))).toBe(true);
  });

  it('does not trust anyone else', () => {
    expect(isTrustedIssue(issue('mallory', 'NONE'))).toBe(false);
    expect(isTrustedIssue(issue('carol', 'CONTRIBUTOR'))).toBe(false);
  });
});
