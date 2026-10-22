/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  type IUserProfile,
  profileChanged,
  syncUserProfile,
  userProfileFrom,
} from './user.js';

const ERIN: IUserProfile = {
  userId: 'user-1',
  email: 'erin@example.com',
  givenName: 'Erin',
  familyName: 'Nguyen',
};

// Records what syncUserProfile would write, with `existing` as the stored
// record.
const fakeUserEntity = (
  existing: Record<string, unknown> | null,
  createError?: Error,
) => {
  const writes: { op: string; args: unknown[] }[] = [];
  const patch = (key: unknown) => {
    const write = { op: 'patch', args: [key] as unknown[] };
    const chain = {
      set: (values: unknown) => {
        write.args.push({ set: values });
        return chain;
      },
      remove: (fields: unknown) => {
        write.args.push({ remove: fields });
        return chain;
      },
      go: async () => {
        writes.push(write);
        return { data: {} };
      },
    };
    return chain;
  };
  const entity = {
    get: vi.fn(() => ({ go: async () => ({ data: existing }) })),
    create: vi.fn((item: unknown) => ({
      go: async () => {
        if (createError) {
          throw createError;
        }
        writes.push({ op: 'create', args: [item] });
        return { data: item };
      },
    })),
    patch,
  };
  return { entity: entity as never, writes };
};

const conditionalCheckFailed = () => {
  const cause = new Error('The conditional request failed');
  cause.name = 'ConditionalCheckFailedException';
  return new Error('Error thrown by DynamoDB client', { cause });
};

describe('userProfileFrom', () => {
  it('reads the profile from Cognito’s attribute names', () => {
    expect(
      userProfileFrom({
        sub: 'user-1',
        email: 'erin@example.com',
        given_name: 'Erin',
        family_name: 'Nguyen',
        'cognito:groups': ['student'],
        email_verified: 'true',
      }),
    ).toEqual(ERIN);
  });

  it('has no profile without a sub, and leaves out empty attributes', () => {
    expect(userProfileFrom({ email: 'erin@example.com' })).toBeUndefined();
    expect(userProfileFrom({ sub: 'user-1', given_name: '' })).toEqual({
      userId: 'user-1',
      email: undefined,
      givenName: undefined,
      familyName: undefined,
    });
  });
});

describe('profileChanged', () => {
  it('is changed when there’s no record yet, or a field differs', () => {
    expect(profileChanged(null, ERIN)).toBe(true);
    expect(profileChanged({ ...ERIN, familyName: 'Tran' }, ERIN)).toBe(true);
  });

  it('ignores what isn’t part of the profile, like timestamps', () => {
    expect(
      profileChanged(
        { ...ERIN, updatedAt: '2026-10-22T00:00:00.000Z' } as IUserProfile,
        ERIN,
      ),
    ).toBe(false);
  });
});

describe('syncUserProfile', () => {
  it('creates the record for a user it hasn’t seen', async () => {
    const { entity, writes } = fakeUserEntity(null);

    expect(await syncUserProfile(entity, ERIN)).toBe('created');
    expect(writes).toEqual([{ op: 'create', args: [ERIN] }]);
  });

  it('writes nothing when the profile hasn’t changed', async () => {
    const { entity, writes } = fakeUserEntity({ ...ERIN, createdAt: 'then' });

    expect(await syncUserProfile(entity, ERIN)).toBe('unchanged');
    expect(writes).toEqual([]);
  });

  it('updates a changed name, and removes an attribute Cognito no longer has', async () => {
    const { entity, writes } = fakeUserEntity({
      ...ERIN,
      familyName: 'Tran',
    });

    expect(await syncUserProfile(entity, { ...ERIN, email: undefined })).toBe(
      'updated',
    );
    expect(writes).toEqual([
      {
        op: 'patch',
        args: [
          { userId: 'user-1' },
          { set: { givenName: 'Erin', familyName: 'Nguyen' } },
          { remove: ['email'] },
        ],
      },
    ]);
  });

  it('updates the record another sign-in created first', async () => {
    const { entity, writes } = fakeUserEntity(null, conditionalCheckFailed());

    expect(await syncUserProfile(entity, ERIN)).toBe('updated');
    expect(writes).toEqual([
      {
        op: 'patch',
        args: [
          { userId: 'user-1' },
          {
            set: {
              email: 'erin@example.com',
              givenName: 'Erin',
              familyName: 'Nguyen',
            },
          },
        ],
      },
    ]);
  });

  it('lets any other failure through', async () => {
    const { entity } = fakeUserEntity(null, new Error('throttled'));

    await expect(syncUserProfile(entity, ERIN)).rejects.toThrow('throttled');
  });
});
