/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { groupsOf, isInGroup } from './groups';

describe('groupsOf', () => {
  it("reads the ID token's cognito:groups", () => {
    expect(
      groupsOf({ sub: 'user-1', 'cognito:groups': ['instructor', 'student'] }),
    ).toEqual(['instructor', 'student']);
  });

  it('is empty without groups, or when the claim is malformed', () => {
    expect(groupsOf({ sub: 'user-1' })).toEqual([]);
    expect(groupsOf(undefined)).toEqual([]);
    expect(groupsOf({ 'cognito:groups': 'instructor' })).toEqual([]);
    expect(groupsOf({ 'cognito:groups': ['admin', 42] })).toEqual(['admin']);
  });
});

describe('isInGroup', () => {
  it('says whether the user is in a group', () => {
    const profile = { 'cognito:groups': ['student'] };
    expect(isInGroup(profile, 'student')).toBe(true);
    expect(isInGroup(profile, 'instructor')).toBe(false);
  });
});
