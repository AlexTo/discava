/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAppConfig, getSecret, getSignedCookies } = vi.hoisted(() => ({
  getAppConfig: vi.fn(),
  getSecret: vi.fn(),
  getSignedCookies: vi.fn(),
}));

vi.mock('@aws-lambda-powertools/parameters/appconfig', () => ({
  getAppConfig,
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
  return import('./cloudfront-client.js');
};

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
    process.env.RUNTIME_CONFIG_APP_ID = 'app-1';
    getAppConfig.mockResolvedValue({
      LessonMediaBucket: {
        bucketName: 'lesson-media-bucket',
        cloudFrontDomainName: DOMAIN_NAME,
        cloudFrontKeyPairId: KEY_PAIR_ID,
        cloudFrontPrivateKeySecretArn: SECRET_ARN,
        cookieDomain: COOKIE_DOMAIN,
      },
    });
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

  it('resolves the private key from the secret named in runtime config', async () => {
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

    expect(getAppConfig).toHaveBeenCalledTimes(1);
    expect(getSecret).toHaveBeenCalledTimes(1);
  });

  it('throws when RUNTIME_CONFIG_APP_ID is not set', async () => {
    delete process.env.RUNTIME_CONFIG_APP_ID;
    const { getSignedCloudFrontCookies } = await importFreshModule();

    await expect(getSignedCloudFrontCookies(PREFIX_KEY)).rejects.toThrow(
      'RUNTIME_CONFIG_APP_ID',
    );
  });

  it('throws when runtime config is missing CloudFront signing fields', async () => {
    getAppConfig.mockResolvedValue({
      LessonMediaBucket: { bucketName: 'lesson-media-bucket' },
    });
    const { getSignedCloudFrontCookies } = await importFreshModule();

    await expect(getSignedCloudFrontCookies(PREFIX_KEY)).rejects.toThrow(
      'Could not resolve CloudFront signing config',
    );
  });

  it('throws when runtime config is missing the cookie domain', async () => {
    getAppConfig.mockResolvedValue({
      LessonMediaBucket: {
        bucketName: 'lesson-media-bucket',
        cloudFrontDomainName: DOMAIN_NAME,
        cloudFrontKeyPairId: KEY_PAIR_ID,
        cloudFrontPrivateKeySecretArn: SECRET_ARN,
      },
    });
    const { getSignedCloudFrontCookies } = await importFreshModule();

    await expect(getSignedCloudFrontCookies(PREFIX_KEY)).rejects.toThrow(
      'Could not resolve CloudFront signing config',
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
    process.env.RUNTIME_CONFIG_APP_ID = 'app-1';
    getAppConfig.mockResolvedValue({
      LessonMediaBucket: {
        bucketName: 'lesson-media-bucket',
        cloudFrontDomainName: DOMAIN_NAME,
        cloudFrontKeyPairId: KEY_PAIR_ID,
        cloudFrontPrivateKeySecretArn: SECRET_ARN,
        cookieDomain: COOKIE_DOMAIN,
      },
    });
  });

  it('builds a plain (unsigned) URL for the object key', async () => {
    const { getCloudFrontVideoUrl } = await importFreshModule();

    const result = await getCloudFrontVideoUrl(MANIFEST_KEY);

    expect(result).toBe(`https://${DOMAIN_NAME}/${MANIFEST_KEY}`);
  });
});
