/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { PreTokenGenerationTriggerEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createUserEntity, syncUserProfile } = vi.hoisted(() => ({
  createUserEntity: vi.fn(),
  syncUserProfile: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createUserEntity,
  syncUserProfile,
}));

const USER_ENTITY = { entity: 'user' };

const signIn = (
  userAttributes: Record<string, string>,
): PreTokenGenerationTriggerEvent => ({
  version: '1',
  triggerSource: 'TokenGeneration_HostedAuth',
  region: 'ap-southeast-2',
  userPoolId: 'pool-1',
  userName: 'erin',
  callerContext: { awsSdkVersion: 'test', clientId: 'client-1' },
  request: { userAttributes, groupConfiguration: { groupsToOverride: [] } },
  response: { claimsOverrideDetails: {} },
});

const ERIN = signIn({
  sub: 'user-1',
  email: 'erin@example.com',
  given_name: 'Erin',
  family_name: 'Nguyen',
});

// A fresh module per test, so the memoized user entity starts empty.
const load = async () => {
  vi.resetModules();
  return import('./pre-token-generation.js');
};

beforeEach(() => {
  createUserEntity.mockResolvedValue(USER_ENTITY);
  syncUserProfile.mockResolvedValue('created');
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('preTokenGeneration', () => {
  it('syncs the user’s record from their attributes and leaves the tokens alone', async () => {
    const { preTokenGeneration } = await load();
    const event = structuredClone(ERIN);

    expect(await preTokenGeneration(event)).toEqual(ERIN);
    expect(syncUserProfile).toHaveBeenCalledWith(USER_ENTITY, {
      userId: 'user-1',
      email: 'erin@example.com',
      givenName: 'Erin',
      familyName: 'Nguyen',
    });
  });

  it('signs the user in anyway when the write fails', async () => {
    const { preTokenGeneration } = await load();
    syncUserProfile.mockRejectedValue(new Error('throttled'));

    expect(await preTokenGeneration(structuredClone(ERIN))).toEqual(ERIN);
  });

  it('gives up on a slow write well inside Cognito’s 5 seconds', async () => {
    const { preTokenGeneration, SYNC_BUDGET_MS } = await load();
    vi.useFakeTimers();
    syncUserProfile.mockReturnValue(new Promise(() => {}));

    const signedIn = preTokenGeneration(structuredClone(ERIN));
    await vi.advanceTimersByTimeAsync(SYNC_BUDGET_MS);

    expect(SYNC_BUDGET_MS).toBeLessThan(5000);
    expect(await signedIn).toEqual(ERIN);
  });

  it('tries the table again on the next sign-in when it couldn’t be found', async () => {
    const { preTokenGeneration } = await load();
    createUserEntity
      .mockRejectedValueOnce(new Error('No table name in AppConfig yet'))
      .mockResolvedValue(USER_ENTITY);

    await preTokenGeneration(structuredClone(ERIN));
    await preTokenGeneration(structuredClone(ERIN));
    await preTokenGeneration(structuredClone(ERIN));

    expect(createUserEntity).toHaveBeenCalledTimes(2);
    expect(syncUserProfile).toHaveBeenCalledTimes(2);
  });

  it('syncs nothing without a sub', async () => {
    const { preTokenGeneration } = await load();
    const event = signIn({ email: 'erin@example.com' });

    expect(await preTokenGeneration(event)).toEqual(event);
    expect(syncUserProfile).not.toHaveBeenCalled();
  });
});
