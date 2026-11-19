/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node

import { RuntimeConfig } from '@discava/common-constructs';
import {
  resolveStage,
  type StageComponents,
} from '@discava/common-infra-config';
import { Match } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { resources, synth } from './stack-test-fixture.js';

describe('lesson media CORS', () => {
  const data = synth({})('Data');
  const origins = (value: unknown) => JSON.stringify(value);

  it('lets both portals stream lesson videos', () => {
    const [policy] = Object.values(
      data.findResources('AWS::CloudFront::ResponseHeadersPolicy'),
    ) as {
      Properties: {
        ResponseHeadersPolicyConfig: {
          CorsConfig: { AccessControlAllowOrigins: { Items: unknown[] } };
        };
      };
    }[];
    const allowed = origins(
      policy.Properties.ResponseHeadersPolicyConfig.CorsConfig
        .AccessControlAllowOrigins.Items,
    );

    // Each portal's CloudFront domain, and its local dev server.
    expect(allowed).toMatch(/StudentPortal/);
    expect(allowed).toMatch(/InstructorPortal/);
    expect(allowed).toContain('http://localhost:4201');
    expect(allowed).toContain('http://localhost:4200');
  });

  // Instructors upload lesson files and videos; students upload their
  // assignment submissions (#102). The admin portal uploads nothing.
  it('lets only the instructor and student portals upload', () => {
    const buckets = Object.entries(data.findResources('AWS::S3::Bucket'));
    const [, upload] = buckets.find(([id]) =>
      id.startsWith('LessonMediaUploadBucket'),
    )!;
    const allowed = origins(
      (upload as { Properties: { CorsConfiguration: unknown } }).Properties
        .CorsConfiguration,
    );

    expect(allowed).toMatch(/InstructorPortal/);
    expect(allowed).toMatch(/StudentPortal/);
    expect(allowed).not.toMatch(/AdminPortal/);
    expect(allowed).not.toContain('localhost:4202');
  });
});

describe('the sign-up trigger (#29)', () => {
  const stack = synth({});

  it('may add users to groups in its own user pool only', () => {
    const data = stack('Data');
    const [userPool] = Object.keys(
      data.findResources('AWS::Cognito::UserPool'),
    );
    const grants = Object.values(data.findResources('AWS::IAM::Policy'))
      .flatMap(
        (policy) =>
          (
            policy as {
              Properties: {
                PolicyDocument: {
                  Statement: { Action: unknown; Resource: unknown }[];
                };
              };
            }
          ).Properties.PolicyDocument.Statement,
      )
      .filter(({ Action }) =>
        [Action].flat().includes('cognito-idp:AdminAddUserToGroup'),
      );

    expect(grants).toEqual([
      expect.objectContaining({
        Resource: { 'Fn::GetAtt': [userPool, 'Arn'] },
      }),
    ]);
  });
});

describe('the user record trigger (#230)', () => {
  const stack = synth({});

  it('runs on every token the pool issues, with the core table to write to', () => {
    const data = stack('Data');
    const [fn] = Object.keys(
      data.findResources('AWS::Lambda::Function', {
        Properties: {
          Environment: {
            Variables: { RUNTIME_CONFIG_APP_ID: Match.anyValue() },
          },
        },
      }),
    ).filter((id) => id.startsWith('PreTokenGeneration'));

    data.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: Match.objectLike({
        PreTokenGeneration: { 'Fn::GetAtt': [fn, 'Arn'] },
      }),
    });
    data.hasResourceProperties('AWS::IAM::Policy', {
      Roles: [
        { Ref: Match.stringLikeRegexp('^PreTokenGenerationServiceRole') },
      ],
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['dynamodb:GetItem', 'dynamodb:PutItem']),
          }),
        ]),
      },
    });
  });
});

// Stages may share an account and region (see StageIsolationSynthesizer),
// where collection and policy names must be unique.
describe('search collection (#53)', () => {
  const stack = synth({});

  // AWS rejects a NextGen group with standby replicas off ("StandbyReplicas
  // cannot be set to DISABLED for NEXTGEN collection groups"), which only
  // showed up deploying discava-development, so check each real stage's.
  it.each(['discava-development', 'discava-production'])(
    "gives %s's collection group NextGen with standby replicas enabled",
    (name) => {
      const config = resolveStage('packages/infra', name)?.infra ?? {};
      synth(config)('Data').hasResourceProperties(
        'AWS::OpenSearchServerless::CollectionGroup',
        { Generation: 'NEXTGEN', StandbyReplicas: 'ENABLED' },
      );
    },
  );

  // The index-sync custom resource runs while the Data stack deploys, before
  // the RuntimeConfig stack has published anything to AppConfig, so a first
  // deploy failed with "ConfigurationProfile not found" when it looked the
  // endpoint up there. It must be handed the endpoint directly.
  it("hands the index-sync handler the collection's endpoint, not AppConfig", () => {
    const [handler] = resources(
      stack('Data'),
      'AWS::Lambda::Function',
      'SearchCollectionIndexSyncHandler',
    ) as { Environment: { Variables: Record<string, unknown> } }[];

    expect(handler.Environment.Variables).toHaveProperty('OPENSEARCH_ENDPOINT');
    expect(handler.Environment.Variables).not.toHaveProperty(
      'RUNTIME_CONFIG_APP_ID',
    );
  });

  it('is named after its stage, as are its policies', () => {
    const template = stack('Data');
    template.hasResourceProperties('AWS::OpenSearchServerless::Collection', {
      Name: 'discava-test',
    });
    template.hasResourceProperties(
      'AWS::OpenSearchServerless::SecurityPolicy',
      {
        Name: 'discava-test-encryption',
      },
    );
  });
});

describe('the notification unsubscribe secret', () => {
  const secrets = (components: StageComponents) =>
    synth(components)('Data').findResources('AWS::SecretsManager::Secret');
  const unsubscribeSecrets = (components: StageComponents) =>
    Object.entries(secrets(components)).filter(([id]) =>
      id.startsWith('NotificationUnsubscribeSecret'),
    );

  it('is a generated 64-character value', () => {
    const [[, secret]] = unsubscribeSecrets({});
    expect(secret.Properties.GenerateSecretString).toMatchObject({
      PasswordLength: 64,
      ExcludePunctuation: true,
    });
  });

  it('is encrypted with a customer-managed key unless the stage turns that off', () => {
    const [[, encrypted]] = unsubscribeSecrets({});
    expect(encrypted.Properties.KmsKeyId).toBeDefined();

    const [[, plain]] = unsubscribeSecrets({
      coreTable: { enableKmsEncryption: false },
    });
    expect(plain.Properties.KmsKeyId).toBeUndefined();
  });

  it('is retained on delete unless the stage opts out, like the table', () => {
    const [[, retained]] = unsubscribeSecrets({});
    expect(retained.DeletionPolicy).toBe('Retain');

    const [[, removed]] = unsubscribeSecrets({
      coreTable: { retainOnDelete: false },
    });
    expect(removed.DeletionPolicy).toBe('Delete');
  });

  it('names every secret under the stage prefix the execution role is scoped to', () => {
    // CI's CloudFormation execution role manages only secrets named
    // `<stage without hyphens>*`.
    const all = Object.values(secrets({}));
    expect(all.length).toBeGreaterThan(1);
    for (const secret of all) {
      expect(secret.Properties.Name).toMatch(/^discavatest/);
    }
  });

  it('is the only notification secret in Data', () => {
    expect(unsubscribeSecrets({})).toHaveLength(1);
  });
});
