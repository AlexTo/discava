/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SIGNED_COOKIE_LIFETIME_SECONDS } from './media-keys.js';

const { getSecret, getSignedCookies } = vi.hoisted(() => ({
  getSecret: vi.fn(),
  getSignedCookies: vi.fn(),
}));

vi.mock('@aws-lambda-powertools/parameters/secrets', () => ({
  getSecret,
}));

vi.mock('@aws-sdk/cloudfront-signer', () => ({
  getSignedCookies,
}));

const DOMAIN_NAME = 'd123.cloudfront.net';
const COOKIE_DOMAIN = 'example.com';
const KEY_PAIR_ID = 'K2JCJMDEHXQW5F';
const SECRET_ARN =
  'arn:aws:secretsmanager:us-east-1:123456789012:secret:signing-key-abc123';
const PRIVATE_KEY_PEM =
  '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----';

// Each test that needs a fresh module (distinct env/config state, or to
// assert caching in isolation) resets the module registry and re-imports:
// resolveCloudFrontConfig/resolvePrivateKey cache in module-level state, so
// reusing one import across tests with different mock setups would leak
// the first successful resolution into later tests.
const importFreshModule = async () => {
  vi.resetModules();
  return import('./lesson-media.js');
};

const LESSON_MEDIA_BUCKET = {
  bucketName: 'lesson-media-bucket',
  cloudFrontDomainName: DOMAIN_NAME,
  cloudFrontKeyPairId: KEY_PAIR_ID,
  cloudFrontPrivateKeySecretArn: SECRET_ARN,
  cookieDomain: COOKIE_DOMAIN,
};

const BUCKET_SETTING = 'DISCAVA_S3_LESSON_MEDIA_BUCKET';
const FIELDS: Record<string, string> = {
  bucketName: 'BUCKET_NAME',
  cloudFrontDomainName: 'CLOUD_FRONT_DOMAIN_NAME',
  cloudFrontKeyPairId: 'CLOUD_FRONT_KEY_PAIR_ID',
  cloudFrontPrivateKeySecretArn: 'CLOUD_FRONT_PRIVATE_KEY_SECRET_ARN',
  cookieDomain: 'COOKIE_DOMAIN',
};

const stubBucketSetting = (value: Record<string, string>) => {
  for (const [field, suffix] of Object.entries(FIELDS)) {
    vi.stubEnv(`${BUCKET_SETTING}_${suffix}`, value[field] ?? '');
  }
};

afterEach(() => {
  vi.unstubAllEnvs();
});

const PREFIX_KEY =
  'courses/course-1/modules/module-1/lessons/lesson-1/content-items/item-1/nonce-1/';
const MANIFEST_KEY = `${PREFIX_KEY}master.m3u8`;

const SIGNED_COOKIES = {
  'CloudFront-Policy': 'fake-policy',
  'CloudFront-Signature': 'fake-signature',
  'CloudFront-Key-Pair-Id': KEY_PAIR_ID,
};

describe('getSignedCloudFrontCookies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubBucketSetting(LESSON_MEDIA_BUCKET);
    getSecret.mockResolvedValue({ privateKeyPem: PRIVATE_KEY_PEM });
    getSignedCookies.mockReturnValue(SIGNED_COOKIES);
  });

  it('signs cookies via a custom policy covering the whole prefix', async () => {
    const { getSignedCloudFrontCookies } = await importFreshModule();

    const result = await getSignedCloudFrontCookies(PREFIX_KEY);

    const [call] = getSignedCookies.mock.calls[0]!;
    expect(call.keyPairId).toBe(KEY_PAIR_ID);
    expect(call.privateKey).toBe(PRIVATE_KEY_PEM);
    expect(call.dateLessThan).toBeUndefined();
    const policy = JSON.parse(call.policy);
    expect(policy.Statement[0].Resource).toBe(
      `https://${DOMAIN_NAME}/${PREFIX_KEY}*`,
    );
    expect(policy.Statement[0].Condition.DateLessThan['AWS:EpochTime']).toEqual(
      expect.any(Number),
    );

    expect(result).toHaveLength(3);
    for (const [name, value] of Object.entries(SIGNED_COOKIES)) {
      expect(result).toContainEqual(
        expect.stringContaining(`${name}=${value};`),
      );
    }
  });

  it('lasts the default lifetime when none is given', async () => {
    const { getSignedCloudFrontCookies } = await importFreshModule();
    const now = Date.now();

    const result = await getSignedCloudFrontCookies(PREFIX_KEY);

    const policy = JSON.parse(getSignedCookies.mock.calls[0]![0].policy);
    const expires = policy.Statement[0].Condition.DateLessThan['AWS:EpochTime'];
    expect(expires).toBeGreaterThanOrEqual(
      Math.floor(now / 1000) + SIGNED_COOKIE_LIFETIME_SECONDS,
    );
    expect(expires).toBeLessThanOrEqual(
      Math.ceil(Date.now() / 1000) + SIGNED_COOKIE_LIFETIME_SECONDS,
    );
    for (const cookie of result) {
      expect(cookie).toContain(`Max-Age=${SIGNED_COOKIE_LIFETIME_SECONDS}`);
    }
  });

  it('expires the policy and the cookies after a given lifetime, for the same prefix only', async () => {
    const { getSignedCloudFrontCookies } = await importFreshModule();
    const now = Date.now();

    const result = await getSignedCloudFrontCookies(PREFIX_KEY, {
      lifetimeSeconds: 3600,
    });

    const policy = JSON.parse(getSignedCookies.mock.calls[0]![0].policy);
    const expires = policy.Statement[0].Condition.DateLessThan['AWS:EpochTime'];
    expect(expires).toBeGreaterThanOrEqual(Math.floor(now / 1000) + 3600);
    expect(expires).toBeLessThanOrEqual(Math.ceil(Date.now() / 1000) + 3600);
    expect(policy.Statement[0].Resource).toBe(
      `https://${DOMAIN_NAME}/${PREFIX_KEY}*`,
    );
    for (const cookie of result) {
      expect(cookie).toContain('Max-Age=3600');
      expect(cookie).toContain(`Path=/${PREFIX_KEY}`);
    }
  });

  it('scopes each cookie to the given prefix and the shared cookie domain', async () => {
    const { getSignedCloudFrontCookies } = await importFreshModule();

    const result = await getSignedCloudFrontCookies(PREFIX_KEY);

    for (const cookie of result) {
      expect(cookie).toContain(`Domain=${COOKIE_DOMAIN}`);
      expect(cookie).toContain(`Path=/${PREFIX_KEY}`);
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=None');
    }
  });

  it('resolves the private key from the secret named in the setting', async () => {
    const { getSignedCloudFrontCookies } = await importFreshModule();

    await getSignedCloudFrontCookies(PREFIX_KEY);

    expect(getSecret).toHaveBeenCalledWith(
      SECRET_ARN,
      expect.objectContaining({ transform: 'json' }),
    );
  });

  it('caches the resolved config and private key across calls', async () => {
    const { getSignedCloudFrontCookies } = await importFreshModule();

    await getSignedCloudFrontCookies(PREFIX_KEY);
    await getSignedCloudFrontCookies(PREFIX_KEY);

    expect(getSecret).toHaveBeenCalledTimes(1);
  });

  it('throws when the bucket setting is not set', async () => {
    stubBucketSetting({});
    const { getSignedCloudFrontCookies } = await importFreshModule();

    await expect(getSignedCloudFrontCookies(PREFIX_KEY)).rejects.toThrow(
      'Missing deploy-time setting DISCAVA_S3_LESSON_MEDIA_BUCKET_CLOUD_FRONT_DOMAIN_NAME',
    );
  });

  it('throws naming the first missing CloudFront signing field', async () => {
    stubBucketSetting({
      bucketName: 'lesson-media-bucket',
      cloudFrontDomainName: DOMAIN_NAME,
    });
    const { getSignedCloudFrontCookies } = await importFreshModule();

    await expect(getSignedCloudFrontCookies(PREFIX_KEY)).rejects.toThrow(
      'Missing deploy-time setting DISCAVA_S3_LESSON_MEDIA_BUCKET_CLOUD_FRONT_KEY_PAIR_ID',
    );
  });

  it('throws when the setting is missing the cookie domain', async () => {
    stubBucketSetting({
      bucketName: 'lesson-media-bucket',
      cloudFrontDomainName: DOMAIN_NAME,
      cloudFrontKeyPairId: KEY_PAIR_ID,
      cloudFrontPrivateKeySecretArn: SECRET_ARN,
    });
    const { getSignedCloudFrontCookies } = await importFreshModule();

    await expect(getSignedCloudFrontCookies(PREFIX_KEY)).rejects.toThrow(
      'Missing deploy-time setting DISCAVA_S3_LESSON_MEDIA_BUCKET_COOKIE_DOMAIN',
    );
  });

  it('throws when the secret has no private key', async () => {
    getSecret.mockResolvedValue(undefined);
    const { getSignedCloudFrontCookies } = await importFreshModule();

    await expect(getSignedCloudFrontCookies(PREFIX_KEY)).rejects.toThrow(
      'Could not resolve CloudFront signing private key',
    );
  });
});

describe('getCloudFrontVideoUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubBucketSetting(LESSON_MEDIA_BUCKET);
  });

  it('builds a plain (unsigned) URL for the object key', async () => {
    const { getCloudFrontVideoUrl } = await importFreshModule();

    const result = await getCloudFrontVideoUrl(MANIFEST_KEY);

    expect(result).toBe(`https://${DOMAIN_NAME}/${MANIFEST_KEY}`);
  });
});

describe('in local dev (#137)', () => {
  beforeEach(() => {
    vi.stubEnv('LOCAL_DEV', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('serves the video straight from S3Mock, with no cookies', async () => {
    const { getCloudFrontVideoUrl, getSignedCloudFrontCookies } =
      await importFreshModule();

    await expect(
      getCloudFrontVideoUrl('courses/c/nonce-1/master.m3u8'),
    ).resolves.toBe(
      'http://localhost:9090/discava-lesson-media/courses/c/nonce-1/master.m3u8',
    );
    await expect(
      getSignedCloudFrontCookies('courses/c/nonce-1/'),
    ).resolves.toEqual([]);
  });
});
