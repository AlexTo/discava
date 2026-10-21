/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
// (CDK resolves asset paths from import.meta.url, which jsdom doesn't provide.)
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { describe, expect, it } from 'vitest';
import { PublicBucket } from './public-bucket.js';
import { RuntimeConfig } from './runtime-config.js';

const setup = (withDomain = false) => {
  const stack = new Stack(new App(), 'Stack', {
    env: { account: 'test-account', region: 'ap-southeast-2' },
  });
  const media = new PublicBucket(stack, 'Media', {
    runtimeConfigKey: 'Public',
    enableWaf: false,
    ...(withDomain && {
      domainNames: ['media.example.com'],
      certificate: Certificate.fromCertificateArn(
        stack,
        'Cert',
        'arn:aws:acm:us-east-1:123456789012:certificate/abc',
      ),
    }),
  });
  return { stack, media };
};

// Synthesizing a stack can pass Vitest's 5s default when CI runs every
// project's tests in parallel.
describe('PublicBucket', { timeout: 30_000 }, () => {
  it('serves objects without requiring a signature', () => {
    const { stack } = setup();

    Template.fromStack(stack).hasResourceProperties(
      'AWS::CloudFront::Distribution',
      {
        DistributionConfig: {
          DefaultCacheBehavior: Match.objectLike({
            TrustedKeyGroups: Match.absent(),
          }),
        },
      },
    );
  });

  it('expires objects tagged unattached after a day', () => {
    const { stack } = setup();

    Template.fromStack(stack).hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: [
          Match.objectLike({
            ExpirationInDays: 1,
            TagFilters: [{ Key: 'lifecycle', Value: 'unattached' }],
            Status: 'Enabled',
          }),
        ],
      },
    });
  });

  it('gives the portals its base URL, on the custom domain when there is one', () => {
    const { stack } = setup(true);

    expect(RuntimeConfig.of(stack)?.get('connection').media).toEqual({
      Public: 'https://media.example.com/',
    });
  });

  it('lets a manager presign uploads and set or clear tags', () => {
    const { stack, media } = setup();
    const role = new Role(stack, 'Role', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });

    media.grantManageObjects(role);

    const actions = Object.values(
      Template.fromStack(stack).findResources('AWS::IAM::Policy'),
    ).flatMap((policy) =>
      policy.Properties.PolicyDocument.Statement.flatMap(
        (statement: { Action: string | string[] }) => [statement.Action].flat(),
      ),
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        's3:PutObject',
        's3:PutObjectTagging',
        's3:DeleteObjectTagging',
        's3:GetObject*',
      ]),
    );
  });
});
