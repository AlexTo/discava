/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { describe, expect, it } from 'vitest';
import { StripeSecrets } from './stripe-secrets.js';

const build = (props = {}) => {
  const stack = new Stack(new App(), 'Stack');
  const secrets = new StripeSecrets(stack, 'Secrets', props);
  const role = (id: string) =>
    new Role(stack, id, {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });
  return { stack, secrets, role };
};

const actionsOf = (template: Template, roleId: string) =>
  Object.values(template.findResources('AWS::IAM::Policy'))
    .filter((p) =>
      (p.Properties.Roles as { Ref: string }[]).some((r) =>
        r.Ref.startsWith(roleId),
      ),
    )
    .flatMap((p) =>
      (
        p.Properties.PolicyDocument.Statement as { Action: string | string[] }[]
      ).flatMap((s) => [s.Action].flat()),
    );

describe('StripeSecrets', () => {
  it('creates the two secrets with no value in the template', () => {
    const template = Template.fromStack(build().stack);
    const secrets = Object.values(
      template.findResources('AWS::SecretsManager::Secret'),
    );
    expect(secrets).toHaveLength(2);
    for (const secret of secrets) {
      expect(secret.Properties).not.toHaveProperty('SecretString');
    }
  });

  it('encrypts both with a KMS key unless the stage turns that off', () => {
    const on = Template.fromStack(build().stack);
    for (const secret of Object.values(
      on.findResources('AWS::SecretsManager::Secret'),
    )) {
      expect(secret.Properties).toHaveProperty('KmsKeyId');
    }
    const off = Template.fromStack(build({ enableKmsEncryption: false }).stack);
    expect(Object.keys(off.findResources('AWS::KMS::Key'))).toEqual([]);
  });

  it('grants checkout the API key only and the webhook both', () => {
    const { stack, secrets, role } = build();
    secrets.grantReadApiKey(role('Checkout'));
    secrets.grantReadWebhookSecret(role('SigningOnly'));
    const webhook = role('WebhookRole');
    secrets.grantReadApiKey(webhook);
    secrets.grantReadWebhookSecret(webhook);
    const template = Template.fromStack(stack);
    const policyFor = (id: string) =>
      JSON.stringify(
        Object.values(template.findResources('AWS::IAM::Policy')).filter((p) =>
          (p.Properties.Roles as { Ref: string }[]).some((r) =>
            r.Ref.startsWith(id),
          ),
        ),
      );
    expect(policyFor('Checkout')).toContain('ApiKey');
    expect(policyFor('Checkout')).not.toContain('WebhookSigningSecret');
    expect(policyFor('WebhookRole')).toContain('WebhookSigningSecret');
    expect(actionsOf(template, 'Checkout')).not.toContain(
      'secretsmanager:PutSecretValue',
    );
  });

  it('lets only grantWrite put a value', () => {
    const { stack, secrets, role } = build();
    secrets.grantReadApiKey(role('Reader'));
    secrets.grantWrite(role('Writer'));
    const template = Template.fromStack(stack);
    expect(actionsOf(template, 'Reader')).not.toContain(
      'secretsmanager:PutSecretValue',
    );
    expect(actionsOf(template, 'Writer')).toContain(
      'secretsmanager:PutSecretValue',
    );
  });
});
