/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
// (CDK resolves asset paths from import.meta.url, which jsdom doesn't provide.)
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { describe, expect, it } from 'vitest';
import { MediaBucket } from './media-bucket.js';

/** The `s3` setting `media` hands a function, as synthesised into its environment. */
const settingOf = (stack: Stack, media: MediaBucket): string => {
  const fn = new Function(stack, 'Reader', {
    runtime: Runtime.NODEJS_24_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = () => {}'),
  });
  media.bindSettings(fn);
  const functions = Template.fromStack(stack).findResources(
    'AWS::Lambda::Function',
  );
  return JSON.stringify(
    functions[stack.getLogicalId(fn.node.defaultChild as any)].Properties
      .Environment.Variables,
  );
};

type Resources = Record<
  string,
  { Type: string; Properties?: unknown; DependsOn?: string | string[] }
>;

/** Logical IDs a resource refers to via Ref, Fn::GetAtt, Fn::Sub or DependsOn. */
const dependenciesOf = (
  id: string,
  resource: Resources[string],
  resources: Resources,
): Set<string> => {
  const found = new Set<string>([resource.DependsOn ?? []].flat());
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'Ref' && typeof value === 'string') {
          found.add(value);
        } else if (key === 'Fn::GetAtt') {
          found.add(
            Array.isArray(value) ? value[0] : String(value).split('.')[0],
          );
        } else if (key === 'Fn::Sub') {
          const template = Array.isArray(value) ? value[0] : value;
          for (const [, ref] of String(template).matchAll(/\$\{([\w]+)/g)) {
            found.add(ref);
          }
          walk(value);
        } else {
          walk(value);
        }
      }
    }
  };
  walk(resource.Properties);
  found.delete(id);
  return new Set([...found].filter((dep) => dep in resources));
};

/** Every dependency cycle among a template's resources, as logical ID paths. */
const findCycles = (resources: Resources): string[][] => {
  const deps = Object.fromEntries(
    Object.entries(resources).map(([id, r]) => [
      id,
      dependenciesOf(id, r, resources),
    ]),
  );
  const state: Record<string, 'visiting' | 'done'> = {};
  const path: string[] = [];
  const cycles: string[][] = [];
  const visit = (id: string): void => {
    state[id] = 'visiting';
    path.push(id);
    for (const dep of deps[id]) {
      if (state[dep] === 'visiting') {
        cycles.push([...path.slice(path.indexOf(dep)), dep]);
      } else if (!state[dep]) {
        visit(dep);
      }
    }
    path.pop();
    state[id] = 'done';
  };
  for (const id of Object.keys(resources)) {
    if (!state[id]) visit(id);
  }
  return cycles;
};

const synthesize = (enableKmsEncryption: boolean) => {
  const stack = new Stack(new App(), 'Stack', {
    env: { account: 'test-account', region: 'ap-southeast-2' },
  });
  new MediaBucket(stack, 'Media', {
    runtimeConfigKey: 'media',
    enableKmsEncryption,
    enableWaf: false,
  });
  return Template.fromStack(stack);
};

const cloudFrontStatements = (template: Template, type: string) =>
  Object.values(template.findResources(type)).flatMap((resource) => {
    const document =
      resource.Properties.PolicyDocument ?? resource.Properties.KeyPolicy;
    return document.Statement.filter((statement: { Principal?: unknown }) =>
      JSON.stringify(statement.Principal ?? '').includes(
        'cloudfront.amazonaws.com',
      ),
    );
  });

// Synthesizing a stack takes well under a second in isolation but can pass
// Vitest's 5s default when CI runs every project's tests in parallel.
describe('MediaBucket', { timeout: 30_000 }, () => {
  it.each([true, false])(
    'has no resource dependency cycle (KMS encryption: %s)',
    (enableKmsEncryption) => {
      const resources = synthesize(enableKmsEncryption).toJSON()
        .Resources as Resources;

      expect(findCycles(resources)).toEqual([]);
    },
  );

  it('lets CloudFront decrypt objects encrypted with the bucket key', () => {
    const statements = cloudFrontStatements(synthesize(true), 'AWS::KMS::Key');

    expect(statements).toEqual([
      expect.objectContaining({ Effect: 'Allow', Action: 'kms:Decrypt' }),
    ]);
  });

  it('only lets this distribution read objects', () => {
    const template = synthesize(true);
    const [distributionId] = Object.keys(
      template.findResources('AWS::CloudFront::Distribution'),
    );
    const statements = cloudFrontStatements(template, 'AWS::S3::BucketPolicy');

    expect(statements).toEqual([
      expect.objectContaining({ Effect: 'Allow', Action: 's3:GetObject' }),
    ]);
    expect(
      JSON.stringify(statements[0].Condition.StringEquals['AWS:SourceArn']),
    ).toContain(`{"Ref":"${distributionId}"}`);
  });

  it('outputs the generated CloudFront domain even with a custom domain configured', () => {
    const stack = new Stack(new App(), 'Stack', {
      env: { account: 'test-account', region: 'ap-southeast-2' },
    });
    const media = new MediaBucket(stack, 'Media', {
      runtimeConfigKey: 'media',
      enableWaf: false,
      domainNames: ['media.example.com'],
      certificate: Certificate.fromCertificateArn(
        stack,
        'Cert',
        'arn:aws:acm:us-east-1:123456789012:certificate/abc',
      ),
    });

    const outputs = Object.values(Template.fromStack(stack).findOutputs('*'));

    expect(outputs).toContainEqual(
      expect.objectContaining({
        Value: stack.resolve(media.cloudFrontDistribution.domainName),
      }),
    );
  });

  it('publishes the custom domain as cloudFrontDomainName when configured', () => {
    const stack = new Stack(new App(), 'Stack', {
      env: { account: 'test-account', region: 'ap-southeast-2' },
    });
    const media = new MediaBucket(stack, 'Media', {
      runtimeConfigKey: 'media',
      enableWaf: false,
      domainNames: ['media.example.com'],
      certificate: Certificate.fromCertificateArn(
        stack,
        'Cert',
        'arn:aws:acm:us-east-1:123456789012:certificate/abc',
      ),
    });

    expect(settingOf(stack, media)).toContain(
      '"DISCAVA_S3_MEDIA_CLOUD_FRONT_DOMAIN_NAME":"media.example.com"',
    );
  });

  it('falls back to the generated CloudFront domain when no custom domain is configured', () => {
    const stack = new Stack(new App(), 'Stack', {
      env: { account: 'test-account', region: 'ap-southeast-2' },
    });
    const media = new MediaBucket(stack, 'Media', {
      runtimeConfigKey: 'media',
      enableWaf: false,
    });

    expect(settingOf(stack, media)).toContain(
      JSON.stringify(stack.resolve(media.cloudFrontDistribution.domainName)),
    );
  });

  it('falls back to the generated CloudFront domain when domainNames is set without a certificate', () => {
    const stack = new Stack(new App(), 'Stack', {
      env: { account: 'test-account', region: 'ap-southeast-2' },
    });
    const media = new MediaBucket(stack, 'Media', {
      runtimeConfigKey: 'media',
      enableWaf: false,
      domainNames: ['media.example.com'],
    });
    const setting = settingOf(stack, media);
    const template = Template.fromStack(stack);

    // domainNames alone never reaches the Distribution as an alias.
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.not(
        Match.objectLike({ Aliases: Match.anyValue() }),
      ),
    });
    expect(setting).toContain(
      JSON.stringify(stack.resolve(media.cloudFrontDistribution.domainName)),
    );
  });
});
