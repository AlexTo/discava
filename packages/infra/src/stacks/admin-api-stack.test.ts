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
  functionsMissingNamedSettings,
  functionsReadingAppConfig,
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

// The brand's images are uploaded and saved by `branding.createUploadUrl` and
// `branding.save`, on one dedicated function that may touch only the brand's
// own object prefixes in the public media bucket.
describe('the branding function (admin-api)', () => {
  const admin = synth({})('AdminApi');
  const functions = admin.findResources('AWS::Lambda::Function') as Record<
    string,
    {
      Properties: {
        Role: { 'Fn::GetAtt': [string, string] };
        Environment?: { Variables?: Record<string, unknown> };
      };
    }
  >;
  const roleOf = (prefix: string) =>
    Object.entries(functions).find(([id]) => id.startsWith(prefix))?.[1]
      .Properties.Role['Fn::GetAtt'][0] as string;
  const environmentOf = (prefix: string) =>
    Object.entries(functions).find(([id]) => id.startsWith(prefix))?.[1]
      .Properties.Environment?.Variables ?? {};

  // The statements of a role that name an S3 object action.
  const objectStatements = (rolePrefix: string) =>
    (
      Object.values(admin.findResources('AWS::IAM::Policy')) as {
        Properties: {
          Roles: { Ref: string }[];
          PolicyDocument: {
            Statement: { Action: string | string[]; Resource: unknown }[];
          };
        };
      }[]
    )
      .filter(({ Properties }) =>
        Properties.Roles.some(({ Ref }) => Ref === roleOf(rolePrefix)),
      )
      .flatMap(({ Properties }) => Properties.PolicyDocument.Statement)
      .filter(({ Action }) =>
        [Action].flat().some((action) => action.startsWith('s3:')),
      );

  it('can write brand images and tags under brand/logo, icon and share-image', () => {
    const statements = objectStatements('AdminApiBrandingHandler');
    const actions = statements.flatMap(({ Action }) => [Action].flat());
    expect(actions).toEqual(
      expect.arrayContaining([
        's3:PutObject',
        's3:PutObjectTagging',
        's3:DeleteObjectTagging',
      ]),
    );
    expect(actions.some((action) => action.startsWith('s3:GetObject'))).toBe(
      true,
    );
    const resources = JSON.stringify(statements.map((s) => s.Resource));
    for (const prefix of [
      'brand/logo/*',
      'brand/icon/*',
      'brand/share-image/*',
    ]) {
      expect(resources).toContain(prefix);
    }
  });

  it('cannot write a course image or the published brand.json', () => {
    const statements = objectStatements('AdminApiBrandingHandler');
    const writes = statements.filter(({ Action }) =>
      [Action].flat().some((action) => action.startsWith('s3:Put')),
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const { Resource } of writes) {
      const resource = JSON.stringify(Resource);
      expect(resource).not.toContain('courses');
      expect(resource).not.toContain('brand.json');
      expect(resource).toMatch(/brand\/(logo|icon|share-image)\/\*/);
    }
  });

  it('has the table and the public media bucket settings', () => {
    const variables = environmentOf('AdminApiBrandingHandler');
    expect(variables).toHaveProperty('DISCAVA_DYNAMODB_CORE_TABLE');
    expect(variables).toHaveProperty('DISCAVA_S3_PUBLIC_MEDIA_BUCKET');
  });

  it('is not the shared router, which has neither the grant nor the setting', () => {
    expect(objectStatements('AdminApiRouterHandler')).toEqual([]);
    expect(environmentOf('AdminApiRouterHandler')).not.toHaveProperty(
      'DISCAVA_S3_PUBLIC_MEDIA_BUCKET',
    );
  });

  it('serves branding.createUploadUrl and branding.save, and branding.get on the router', () => {
    const methods = Object.values(
      admin.findResources('AWS::ApiGateway::Method'),
    );
    const resources = admin.findResources('AWS::ApiGateway::Resource');
    const integrationOf = (path: string) => {
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
    expect(integrationOf('branding.save')).toContain('BrandingHandler');
    expect(integrationOf('branding.createUploadUrl')).toContain(
      'BrandingHandler',
    );
    expect(integrationOf('branding.get')).toContain('RouterHandler');
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

describe('deploy-time settings per function', () => {
  const template = synth({})('AdminApi');
  // Function logical-ID prefix to the settings its code reads.
  const required = {
    AdminApiRouterHandler: ['DISCAVA_DYNAMODB_CORE_TABLE'],
    AdminApiPaymentsConnectHandler: ['DISCAVA_DYNAMODB_CORE_TABLE'],
    AdminApiBrandingHandler: [
      'DISCAVA_DYNAMODB_CORE_TABLE',
      'DISCAVA_S3_PUBLIC_MEDIA_BUCKET',
    ],
  };

  it('gives each function the settings its code reads', () => {
    expect(functionsMissingNamedSettings(template, required)).toEqual([]);
  });

  it('leaves no function able to read AppConfig', () => {
    expect(functionsReadingAppConfig(template)).toEqual([]);
  });
});
