/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import { getSignedCookies, getSignedUrl } from '@aws-sdk/cloudfront-signer';
import { isLocalDev, localObjectUrl } from './local-dev.js';
import {
  FILE_URL_LIFETIME_SECONDS,
  SIGNED_COOKIE_LIFETIME_SECONDS,
} from './media-keys.js';
import { readSetting, settingEnvName } from './settings.js';

const runtimeConfigKey = 'LessonMediaBucket';

type CloudFrontConfig = {
  cloudFrontDomainName: string;
  cloudFrontKeyPairId: string;
  cloudFrontPrivateKeySecretArn: string;
  cookieDomain?: string;
};

let _config: CloudFrontConfig | undefined;
let _privateKey: string | undefined;

const resolveCloudFrontConfig = async (): Promise<CloudFrontConfig> => {
  if (_config === undefined) {
    _config = readSetting(
      's3',
      runtimeConfigKey,
      [
        'cloudFrontDomainName',
        'cloudFrontKeyPairId',
        'cloudFrontPrivateKeySecretArn',
      ],
      ['cookieDomain'],
    );
  }
  return _config;
};

const resolvePrivateKey = async (secretArn: string): Promise<string> => {
  if (_privateKey === undefined) {
    const secret = await getSecret<{ privateKeyPem: string }>(secretArn, {
      transform: 'json',
    });
    if (!secret?.privateKeyPem) {
      throw new Error('Could not resolve CloudFront signing private key');
    }
    _privateKey = secret.privateKeyPem;
  }
  return _privateKey;
};

// The cookies gate every request for the rest of the viewing session
// (manifest, renditions, every segment), so they must outlast one sitting.
/**
 * Signs CloudFront cookies via a custom policy whose wildcard resource
 * covers every object under `prefixKey` -- HLS needs the manifest plus
 * separate rendition/segment files, all distinct S3 objects, and a signed
 * URL can't authorize them: hls.js/native players resolve those as
 * relative URIs without propagating a parent request's query string, so
 * only cookies (attached automatically to every request for the domain)
 * authorize the whole set uniformly.
 */
export const getSignedCloudFrontCookies = async (
  prefixKey: string,
  {
    lifetimeSeconds = SIGNED_COOKIE_LIFETIME_SECONDS,
  }: {
    lifetimeSeconds?: number;
  } = {},
): Promise<string[]> => {
  // Local dev serves lesson media straight from S3Mock, unsigned (#137).
  if (isLocalDev()) {
    return [];
  }
  const {
    cloudFrontDomainName,
    cloudFrontKeyPairId,
    cloudFrontPrivateKeySecretArn,
    cookieDomain,
  } = await resolveCloudFrontConfig();
  // Only the cookies need it: a signed URL carries its own host.
  if (!cookieDomain) {
    throw new Error(
      `Missing deploy-time setting ${settingEnvName('s3', runtimeConfigKey, 'cookieDomain')}`,
    );
  }
  const privateKey = await resolvePrivateKey(cloudFrontPrivateKeySecretArn);
  const expiresAt = Date.now() + lifetimeSeconds * 1000;

  const policy = JSON.stringify({
    Statement: [
      {
        Resource: `https://${cloudFrontDomainName}/${prefixKey}*`,
        Condition: {
          DateLessThan: { 'AWS:EpochTime': Math.floor(expiresAt / 1000) },
        },
      },
    ],
  });

  const signedCookies = getSignedCookies({
    policy,
    keyPairId: cloudFrontKeyPairId,
    privateKey,
  });

  const attributes = `Domain=${cookieDomain}; Path=/${prefixKey}; Secure; HttpOnly; SameSite=None; Max-Age=${lifetimeSeconds}`;
  return Object.entries(signedCookies).map(
    ([name, value]) => `${name}=${value}; ${attributes}`,
  );
};

export const getCloudFrontVideoUrl = async (
  objectKey: string,
): Promise<string> => {
  // S3Mock's own URL in local dev, with no cookies to go with it (#137).
  if (isLocalDev()) {
    return localObjectUrl(runtimeConfigKey, objectKey);
  }
  const { cloudFrontDomainName } = await resolveCloudFrontConfig();
  return `https://${cloudFrontDomainName}/${objectKey}`;
};

// A signed CloudFront URL for one object in the lesson media bucket, e.g. a
// file item's file. Local dev serves it straight from S3Mock, unsigned (#137).
export const getSignedCloudFrontFileUrl = async (
  objectKey: string,
): Promise<string> => {
  if (isLocalDev()) {
    return localObjectUrl(runtimeConfigKey, objectKey);
  }
  const {
    cloudFrontDomainName,
    cloudFrontKeyPairId,
    cloudFrontPrivateKeySecretArn,
  } = await resolveCloudFrontConfig();
  const privateKey = await resolvePrivateKey(cloudFrontPrivateKeySecretArn);
  return getSignedUrl({
    url: `https://${cloudFrontDomainName}/${objectKey
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`,
    keyPairId: cloudFrontKeyPairId,
    privateKey,
    dateLessThan: new Date(
      Date.now() + FILE_URL_LIFETIME_SECONDS * 1000,
    ).toISOString(),
  });
};
