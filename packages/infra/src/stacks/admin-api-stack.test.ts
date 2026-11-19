/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node

import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import {
  actionsByRole,
  actionsOf,
  methodSettings,
  stackTemplates,
  synth,
} from './stack-test-fixture.js';

// The Stripe key travels in `payment.connect`'s request, and two secrets hold
// what an administrator saves. Only the one function that connects and
// disconnects Stripe may write them.
describe('the Stripe connect function (admin-api)', () => {
  const stack = synth({});
  const admin = stack('AdminApi');
  const functions = admin.findResources('AWS::Lambda::Function') as Record<
    string,
    { Properties: { Role: { 'Fn::GetAtt': [string, string] } } }
  >;
  const roleOf = (prefix: string) => {
    const [fn] = Object.entries(functions).filter(([id]) =>
      id.startsWith(prefix),
    );
    expect(fn, prefix).toBeDefined();
    return fn?.[1].Properties.Role['Fn::GetAtt'][0] as string;
  };
  const actionsFor = (prefix: string) =>
    Object.entries(actionsByRole(admin))
      .filter(([role]) => role === roleOf(prefix))
      .flatMap(([, actions]) => actions);

  it('may write both secrets and read the key, and use the table', () => {
    const actions = actionsFor('AdminApiPaymentsConnectHandler');
    expect(actions).toEqual(
      expect.arrayContaining([
        'secretsmanager:PutSecretValue',
        'secretsmanager:GetSecretValue',
        'dynamodb:PutItem',
      ]),
    );
    const policies = JSON.stringify(admin.findResources('AWS::IAM::Policy'));
    // Both secrets are named, in a statement that allows a write.
    for (const secret of ['ApiKey', 'WebhookSigningSecret']) {
      expect(policies).toContain(secret);
    }
  });

  it('is told where the secrets are, and keeps no value in its environment', () => {
    const [fn] = Object.entries(functions).filter(([id]) =>
      id.startsWith('AdminApiPaymentsConnectHandler'),
    );
    const environment = JSON.stringify(
      (fn?.[1].Properties as unknown as { Environment: unknown }).Environment,
    );
    expect(environment).toContain('STRIPE_API_KEY_SECRET_ARN');
    expect(environment).toContain('STRIPE_WEBHOOK_SECRET_ARN');
    expect(environment).toContain('STRIPE_ENDPOINT_STAGE');
    expect(environment).not.toMatch(/sk_|whsec_/);
  });

  it('is the only role of the admin API with any secrets access', () => {
    for (const [role, actions] of Object.entries(actionsByRole(admin))) {
      const touchesSecrets = actions.some((a) =>
        a.startsWith('secretsmanager:'),
      );
      expect(touchesSecrets, role).toBe(
        role === roleOf('AdminApiPaymentsConnectHandler'),
      );
    }
    expect(actionsOf(admin, roleOf('AdminApiRouterHandler'))).not.toContain(
      'secretsmanager:GetSecretValue',
    );
  });

  it('is served on its own function, with payment.status on the shared router', () => {
    const methods = Object.values(
      admin.findResources('AWS::ApiGateway::Method'),
    );
    const integrationOf = (path: string) => {
      const resources = admin.findResources('AWS::ApiGateway::Resource');
      const id = Object.entries(resources).find(
        ([, r]) =>
          (r as { Properties: { PathPart: string } }).Properties.PathPart ===
          path,
      )?.[0];
      const method = methods.find((m) =>
        JSON.stringify(
          (m as { Properties: { ResourceId: unknown } }).Properties.ResourceId,
        ).includes(id as string),
      ) as { Properties: { Integration: { Uri: unknown } } };
      return JSON.stringify(method.Properties.Integration.Uri);
    };
    expect(integrationOf('payment.connect')).toContain(
      'PaymentsConnectHandler',
    );
    expect(integrationOf('payment.disconnect')).toContain(
      'PaymentsConnectHandler',
    );
    expect(integrationOf('payment.status')).toContain('RouterHandler');
    expect(integrationOf('category.list')).toContain('RouterHandler');
  });

  it('is in a stack that waits for Data', () => {
    const dependencies = JSON.stringify(
      (admin.toJSON() as { Resources: unknown }).Resources,
    );
    expect(dependencies).toContain('Data');
  });
});

describe('no logging of the request that carries the key', () => {
  const admin = synth({})('AdminApi');

  it('never turns on API Gateway data tracing or full request logging', () => {
    for (const settings of methodSettings(admin)) {
      expect(settings).not.toHaveProperty('DataTraceEnabled', true);
      expect(settings).not.toHaveProperty('LoggingLevel', 'INFO');
    }
  });

  it('writes an access log with no request or response body', () => {
    const stages = Object.values(
      admin.findResources('AWS::ApiGateway::Stage'),
    ) as {
      Properties: { AccessLogSetting?: { Format: string } };
    }[];
    const formats = stages.flatMap(
      (s) => s.Properties.AccessLogSetting?.Format ?? [],
    );
    expect(formats.length).toBeGreaterThan(0);
    for (const format of formats) {
      expect(format.toLowerCase()).not.toMatch(/body|\$input|payload/);
    }
  });
});

describe('the Stripe secrets', () => {
  const templates = stackTemplates({});

  it('are created in Data, with no value in the template', () => {
    const data = templates.find(([name]) => name === 'Data')?.[1] as Template;
    const secrets = Object.entries(
      data.findResources('AWS::SecretsManager::Secret'),
    ).filter(([id]) => id.startsWith('StripeSecrets'));
    expect(secrets).toHaveLength(2);
    for (const [, secret] of secrets) {
      const { Properties } = secret as { Properties: Record<string, unknown> };
      expect(JSON.stringify(Properties)).not.toMatch(/sk_|rk_|whsec_/);
      expect(Properties).not.toHaveProperty('SecretString');
    }
  });

  it('can be written by no role outside the one admin function', () => {
    for (const [name, template] of templates) {
      for (const [role, actions] of Object.entries(actionsByRole(template))) {
        if (
          actions.includes('secretsmanager:PutSecretValue') ||
          actions.includes('secretsmanager:UpdateSecret')
        ) {
          expect(`${name}/${role}`).toMatch(
            /^AdminApi\/AdminApiPaymentsConnectHandler/,
          );
        }
      }
    }
  });
});
