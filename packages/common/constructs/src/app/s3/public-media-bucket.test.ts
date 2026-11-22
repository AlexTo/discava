/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
// (CDK resolves asset paths from import.meta.url, which jsdom doesn't provide.)
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { PublicMediaBucket } from './public-media-bucket.js';

const template = () => {
  const stack = new Stack(new App(), 'Stack', {
    env: { account: 'test-account', region: 'ap-southeast-2' },
  });
  new PublicMediaBucket(stack, 'Media', { enableWaf: false });
  return Template.fromStack(stack);
};

// Synthesizing a stack can pass Vitest's 5s default when CI runs every
// project's tests in parallel.
describe('PublicMediaBucket', { timeout: 30_000 }, () => {
  it('serves brand/* from the same bucket with caching, CORS and a sandboxing CSP', () => {
    const t = template();
    const [distribution] = Object.values(
      t.findResources('AWS::CloudFront::Distribution'),
    );
    const config = distribution?.Properties.DistributionConfig;
    expect(config.CacheBehaviors).toHaveLength(1);
    const [behavior] = config.CacheBehaviors;
    expect(behavior.PathPattern).toBe('brand/*');
    expect(behavior.TargetOriginId).toBe(
      config.DefaultCacheBehavior.TargetOriginId,
    );
    expect(behavior.AllowedMethods).toEqual(['GET', 'HEAD']);
    expect(behavior.ViewerProtocolPolicy).toBe('redirect-to-https');
    // CachingOptimized
    expect(behavior.CachePolicyId).toBe('658327ea-f89d-4fab-a63d-7e88639e58f6');

    t.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: {
        CorsConfig: {
          AccessControlAllowCredentials: false,
          AccessControlAllowMethods: { Items: ['GET', 'HEAD'] },
          AccessControlAllowOrigins: { Items: ['*'] },
          OriginOverride: true,
        },
        SecurityHeadersConfig: {
          ContentSecurityPolicy: {
            ContentSecurityPolicy:
              "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
            Override: true,
          },
          ContentTypeOptions: { Override: true },
        },
      },
    });
    expect(behavior.ResponseHeadersPolicyId).toBeDefined();
  });

  it('leaves the default behavior as it was: no response headers policy', () => {
    const [distribution] = Object.values(
      template().findResources('AWS::CloudFront::Distribution'),
    );
    expect(
      distribution?.Properties.DistributionConfig.DefaultCacheBehavior,
    ).toEqual(
      expect.not.objectContaining({
        ResponseHeadersPolicyId: Match.anyValue(),
      }),
    );
    expect(
      distribution?.Properties.DistributionConfig.DefaultCacheBehavior
        .ResponseHeadersPolicyId,
    ).toBeUndefined();
  });
});
