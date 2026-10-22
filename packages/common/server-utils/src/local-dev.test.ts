/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalUserSync,
  localBucketName,
  s3ClientConfig,
} from './local-dev.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('s3ClientConfig', () => {
  it('leaves a deployed Lambda’s S3 client to its defaults', () => {
    vi.stubEnv('LOCAL_DEV', undefined);

    expect(s3ClientConfig()).toEqual({});
  });

  it('points local dev at S3Mock, with path-style URLs', () => {
    vi.stubEnv('LOCAL_DEV', 'true');

    expect(s3ClientConfig()).toMatchObject({
      endpoint: 'http://127.0.0.1:9090',
      forcePathStyle: true,
    });
  });
});

describe('localBucketName', () => {
  it('names the S3Mock bucket for a runtime config key', () => {
    expect(localBucketName('PublicMediaBucket')).toBe('discava-public-media');
  });

  it('refuses a key with no local bucket', () => {
    expect(() => localBucketName('SomethingElse')).toThrow(
      'No local bucket for SomethingElse',
    );
  });
});

describe('createLocalUserSync', () => {
  const ALICE = {
    sub: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    given_name: 'Alice',
    family_name: 'Instructor',
    'cognito:groups': ['instructor'],
  };

  it('runs the trigger the first time it sees a user, with their profile claims', async () => {
    const signIn = vi.fn(async () => {});
    const sync = createLocalUserSync(signIn);

    await sync(ALICE);
    await sync(ALICE);

    expect(signIn).toHaveBeenCalledExactlyOnceWith({
      userName: 'alice',
      userAttributes: {
        sub: 'user-1',
        email: 'alice@example.com',
        given_name: 'Alice',
        family_name: 'Instructor',
      },
    });
  });

  it('shares one run between requests that arrive together', async () => {
    let finish: () => void = () => {};
    const signIn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const sync = createLocalUserSync(signIn);

    const together = Promise.all([sync(ALICE), sync(ALICE), sync(ALICE)]);
    finish();
    await together;

    expect(signIn).toHaveBeenCalledOnce();
  });

  it('syncs again when the user’s name changes', async () => {
    const signIn = vi.fn(async () => {});
    const sync = createLocalUserSync(signIn);

    await sync(ALICE);
    await sync({ ...ALICE, family_name: 'Admin' });

    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it('lets the request go ahead when the trigger fails, and retries on the next', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const signIn = vi
      .fn()
      .mockRejectedValueOnce(new Error('event runner not up'))
      .mockResolvedValue(undefined);
    const sync = createLocalUserSync(signIn);

    await expect(sync(ALICE)).resolves.toBeUndefined();
    await sync(ALICE);
    await sync(ALICE);

    expect(signIn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('does nothing for a request without a signed-in user', async () => {
    const signIn = vi.fn(async () => {});
    const sync = createLocalUserSync(signIn);

    await sync(undefined);
    await sync({ email: 'no-sub@example.com' });

    expect(signIn).not.toHaveBeenCalled();
  });
});
