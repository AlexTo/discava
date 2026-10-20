/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getAppConfig } from '@aws-lambda-powertools/parameters/appconfig';
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import { getSignedCookies } from '@aws-sdk/cloudfront-signer';

const runtimeConfigKey = 'LessonMediaBucket';

type S3Config = {
  bucketName: string;
  cloudFrontDomainName: string;
  cloudFrontKeyPairId: string;
  cloudFrontPrivateKeySecretArn: string;
  cookieDomain: string;
};

type CloudFrontConfig = Pick<
  S3Config,
  | 'cloudFrontDomainName'
  | 'cloudFrontKeyPairId'
  | 'cloudFrontPrivateKeySecretArn'
  | 'cookieDomain'
>;

let _config: CloudFrontConfig | undefined;
let _privateKey: string | undefined;

const resolveCloudFrontConfig = async (): Promise<CloudFrontConfig> => {
  if (_config === undefined) {
    const appId = process.env.RUNTIME_CONFIG_APP_ID;
    if (!appId) {
      throw new Error('RUNTIME_CONFIG_APP_ID environment variable is not set');
    }
    const config = await getAppConfig<{
      [key: string]: S3Config | undefined;
    }>('s3', {
      application: appId,
      environment: 'default',
      transform: 'json',
    });
    const entry = config?.[runtimeConfigKey];
    if (
      !entry?.cloudFrontDomainName ||
      !entry?.cloudFrontKeyPairId ||
      !entry?.cloudFrontPrivateKeySecretArn ||
      !entry?.cookieDomain
    ) {
      throw new Error(
        'Could not resolve CloudFront signing config from runtime config',
      );
    }
    _config = {
      cloudFrontDomainName: entry.cloudFrontDomainName,
      cloudFrontKeyPairId: entry.cloudFrontKeyPairId,
      cloudFrontPrivateKeySecretArn: entry.cloudFrontPrivateKeySecretArn,
      cookieDomain: entry.cookieDomain,
    };
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

// With a signed URL, expiry only gated the single already-generated URL.
// With cookies, the same expiry gates every request for the rest of the
// viewing session (manifest, renditions, every segment), so this needs to
// comfortably outlast one sitting rather than one request.
const COOKIE_EXPIRY_SECONDS = 4 * 60 * 60;

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
): Promise<string[]> => {
  const {
    cloudFrontDomainName,
    cloudFrontKeyPairId,
    cloudFrontPrivateKeySecretArn,
    cookieDomain,
  } = await resolveCloudFrontConfig();
  const privateKey = await resolvePrivateKey(cloudFrontPrivateKeySecretArn);
  const expiresAt = Date.now() + COOKIE_EXPIRY_SECONDS * 1000;

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

  const attributes = `Domain=${cookieDomain}; Path=/${prefixKey}; Secure; HttpOnly; SameSite=None; Max-Age=${COOKIE_EXPIRY_SECONDS}`;
  return Object.entries(signedCookies).map(
    ([name, value]) => `${name}=${value}; ${attributes}`,
  );
};

export const getCloudFrontVideoUrl = async (
  objectKey: string,
): Promise<string> => {
  const { cloudFrontDomainName } = await resolveCloudFrontConfig();
  return `https://${cloudFrontDomainName}/${objectKey}`;
};
