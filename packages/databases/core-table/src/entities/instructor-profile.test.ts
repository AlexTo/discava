/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createInstructorProfileEntity } from './instructor-profile.js';
import { createProfileHandleClaimEntity } from './profile-handle-claim.js';

// The requests ElectroDB would send, checked without a table.

let profile: Awaited<ReturnType<typeof createInstructorProfileEntity>>;
let claim: Awaited<ReturnType<typeof createProfileHandleClaimEntity>>;
beforeAll(async () => {
  profile = await createInstructorProfileEntity();
  claim = await createProfileHandleClaimEntity();
});

const record = {
  instructorId: 'instructor-1',
  handle: 'alex-to',
  displayName: 'Alex To',
};

const build = (overrides: Record<string, unknown> = {}) =>
  profile.create({ ...record, ...overrides } as never).params();

describe('instructorProfile', () => {
  it('is created at version 1 with its timestamps', () => {
    const { Item } = build() as { Item: Record<string, unknown> };

    expect(Item).toMatchObject({ ...record, version: 1 });
    expect(Item).toHaveProperty('createdAt');
    expect(Item).toHaveProperty('updatedAt');
  });

  it('keys the record on the instructor alone', () => {
    const { Item } = build() as { Item: Record<string, string> };

    expect(Item.pk).toContain('instructor-1');
    expect(Item.sk).toContain('instructor-1');
  });

  it.each(['instructorId', 'handle', 'displayName'])(
    'refuses a profile without %s',
    (field) => {
      expect(() =>
        profile.create({ ...record, [field]: undefined } as never).params(),
      ).toThrow();
    },
  );

  it.each([
    ['too short', 'ab'],
    ['too long', 'a'.repeat(31)],
    ['double hyphen', 'a--b'],
    ['leading hyphen', '-abc'],
    ['trailing hyphen', 'abc-'],
    ['upper case', 'Alex'],
    ['punctuation', 'alex_to'],
  ])('refuses a handle that is %s', (_, handle) => {
    expect(() => build({ handle })).toThrow();
  });

  it.each(['abc', 'a'.repeat(30), 'a-b-c', 'alex-2'])(
    'takes the handle %s',
    (handle) => {
      expect(() => build({ handle })).not.toThrow();
    },
  );

  it('takes a display name of 1 to 60 characters', () => {
    expect(() => build({ displayName: 'a' })).not.toThrow();
    expect(() => build({ displayName: 'a'.repeat(60) })).not.toThrow();
    expect(() => build({ displayName: '' })).toThrow();
    expect(() => build({ displayName: 'a'.repeat(61) })).toThrow();
  });

  it('takes a headline up to 100 characters', () => {
    expect(() => build({ headline: 'a'.repeat(100) })).not.toThrow();
    expect(() => build({ headline: 'a'.repeat(101) })).toThrow();
  });

  it('takes a bio up to 2,000 characters', () => {
    expect(() => build({ bio: 'a'.repeat(2000) })).not.toThrow();
    expect(() => build({ bio: 'a'.repeat(2001) })).toThrow();
  });
});

describe('profileHandleClaim', () => {
  it('is created with the handle as its key', () => {
    const { Item } = claim
      .create({ handle: 'alex-to', instructorId: 'instructor-1' })
      .params() as { Item: Record<string, string> };

    expect(Item).toMatchObject({
      handle: 'alex-to',
      instructorId: 'instructor-1',
    });
    expect(Item.pk).toContain('alex-to');
    expect(Item.sk).toContain('alex-to');
    expect(Item).toHaveProperty('createdAt');
  });

  it.each(['handle', 'instructorId'])('refuses a claim without %s', (field) => {
    expect(() =>
      claim
        .create({
          handle: 'alex-to',
          instructorId: 'instructor-1',
          [field]: undefined,
        } as never)
        .params(),
    ).toThrow();
  });

  it('cannot have its createdAt changed', () => {
    expect(() =>
      claim
        .patch({ handle: 'alex-to' })
        .set({ createdAt: 'x' } as never)
        .params(),
    ).toThrow();
  });
});
