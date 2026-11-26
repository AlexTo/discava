/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node

import { resolveStage } from '@discava/common-infra-config';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { resources, synth } from './stack-test-fixture.js';

const stageConfig = (name: string) =>
  resolveStage('packages/infra', name)?.infra ?? {};

const rendererEnvironment = (template: Template) => {
  const [fn] = resources(
    template,
    'AWS::Lambda::Function',
    'StudentPortalPageRenderer',
  ) as {
    Environment: { Variables: Record<string, unknown> };
  }[];
  return fn.Environment.Variables;
};

const responseHeaders = (template: Template) =>
  JSON.stringify(
    resources(
      template,
      'AWS::CloudFront::ResponseHeadersPolicy',
      'StudentPortal',
    ),
  );

describe('the student portal page renderer', () => {
  it('is open to search engines in production', () => {
    const websites = synth(stageConfig('discava-production'))('Websites');
    expect(rendererEnvironment(websites).ALLOW_SEARCH_ENGINE_INDEXING).toBe(
      'true',
    );
    expect(responseHeaders(websites)).not.toContain('X-Robots-Tag');
  });

  it('is closed to search engines in development, with less concurrency', () => {
    const websites = synth(stageConfig('discava-development'))('Websites');
    expect(rendererEnvironment(websites).ALLOW_SEARCH_ENGINE_INDEXING).toBe(
      'false',
    );
    expect(responseHeaders(websites)).toContain('X-Robots-Tag');
    expect(responseHeaders(websites)).toContain('noindex');
    websites.hasResourceProperties('AWS::Lambda::Function', {
      ReservedConcurrentExecutions: 5,
    });
  });

  it("is told its stage's settings parameter, not an AppConfig application", () => {
    const environment = rendererEnvironment(synth({})('Websites'));
    expect(environment.PAGE_RENDERER_PARAMETER).toBe(
      '/discava-test/page-renderer',
    );
    expect(environment).not.toHaveProperty('RUNTIME_CONFIG_APP_ID');
  });

  it('serves its page paths, bare and nested, from a function URL that only CloudFront can call', () => {
    const websites = synth({})('Websites');
    websites.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'AWS_IAM' });
    const [distribution] = resources(
      websites,
      'AWS::CloudFront::Distribution',
      'StudentPortal',
    ) as {
      DistributionConfig: {
        CacheBehaviors: { PathPattern: string; AllowedMethods: string[] }[];
      };
    }[];
    const behaviors = distribution.DistributionConfig.CacheBehaviors;
    expect(behaviors.map((b) => b.PathPattern).sort()).toEqual([
      '/certificates',
      '/certificates/*',
      '/instructors',
      '/instructors/*',
      '/learn',
      '/learn/*',
      '/robots.txt',
      '/sitemap.xml',
    ]);
    for (const behavior of behaviors) {
      expect(behavior.AllowedMethods).toEqual(['GET', 'HEAD']);
    }
  });

  it('no longer turns every missing file into index.html', () => {
    const distributions = resources(
      synth({})('Websites'),
      'AWS::CloudFront::Distribution',
      'StudentPortal',
      'InstructorPortal',
      'AdminPortal',
    ) as { DistributionConfig: { CustomErrorResponses?: unknown } }[];
    expect(distributions).toHaveLength(3);
    for (const { DistributionConfig } of distributions) {
      expect(DistributionConfig.CustomErrorResponses).toBeUndefined();
    }
  });

  it('may read index.html and nothing else in the bucket', () => {
    const websites = synth({})('Websites');
    const policies = JSON.stringify(
      resources(websites, 'AWS::IAM::Policy', 'StudentPortalPageRenderer'),
    );
    expect(policies).toContain('s3:GetObject');
    expect(policies).toContain('/index.html');
    expect(policies).not.toContain('s3:ListBucket');
  });

  it('keeps the table and settings parameter grants in Data, and Websites free of imports', () => {
    const stack = synth(stageConfig('discava-production'));
    expect(JSON.stringify(stack('Websites').toJSON())).not.toContain(
      'Fn::ImportValue',
    );
    const data = stack('Data');
    const policies = resources(
      data,
      'AWS::IAM::Policy',
      'PageRendererRole',
    ) as {
      PolicyDocument: { Statement: { Action: string | string[] }[] };
      Roles: unknown[];
    }[];
    expect(policies).toHaveLength(1);
    const actions = policies[0]!.PolicyDocument.Statement.flatMap((s) =>
      [s.Action].flat(),
    );
    expect(actions).toContain('dynamodb:GetItem');
    expect(actions).toContain('dynamodb:Query');
    expect(actions).toContain('kms:Decrypt');
    expect(actions).toContain('ssm:GetParameter');
    expect(actions.some((a) => a.startsWith('appconfig:'))).toBe(false);
    expect(actions.some((a) => a === 'dynamodb:PutItem')).toBe(false);
  });
});
