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
import { localPortalOrigins } from '@discava/common-infra-config/local-portals';
import { STREAM_FEATURES } from '@discava/core-table';
import { App, type Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import {
  actionsByRole,
  actionsOf,
  functionsReadingAppConfig,
  methodSettings,
  resources,
  stackTemplates,
  synth,
} from '../stacks/stack-test-fixture.js';
import { ApplicationStage } from './application-stage.js';

const API_FUNCTIONS = {
  CoreApi: [
    'CoreApiRouterHandler',
    'CoreApiMediaUrlHandler',
    'CoreApiAssignmentSubmitHandler',
    'CoreApiPaymentsCheckoutHandler',
  ],
  InstructorApi: [
    'InstructorApiRouterHandler',
    'InstructorApiMediaUrlHandler',
    'InstructorApiMediaHandler',
    'InstructorApiCourseImageHandler',
  ],
  AdminApi: ['AdminApiRouterHandler', 'AdminApiPaymentsConnectHandler'],
  Payments: ['StripeWebhookApiHandler'],
};

describe("discava-development's limits", () => {
  const stack = synth(
    resolveStage('packages/infra', 'discava-development')?.infra ?? {},
  );

  it('throttles each core-api method, and the public ones harder', () => {
    const settings = methodSettings(stack('CoreApi'));

    expect(settings).toContainEqual(
      expect.objectContaining({
        HttpMethod: '*',
        ResourcePath: '/*',
        ThrottlingRateLimit: 2,
        ThrottlingBurstLimit: 5,
      }),
    );
    for (const op of ['course.publicList', 'course.publicView']) {
      expect(settings).toContainEqual(
        expect.objectContaining({
          HttpMethod: 'GET',
          ResourcePath: `/~1${op}`,
          ThrottlingRateLimit: 1,
          ThrottlingBurstLimit: 3,
        }),
      );
    }
  });

  it('throttles each instructor-api method', () => {
    expect(methodSettings(stack('InstructorApi'))).toContainEqual(
      expect.objectContaining({
        ResourcePath: '/*',
        ThrottlingRateLimit: 2,
        ThrottlingBurstLimit: 5,
      }),
    );
  });

  it('throttles each admin-api method', () => {
    expect(methodSettings(stack('AdminApi'))).toContainEqual(
      expect.objectContaining({
        ResourcePath: '/*',
        ThrottlingRateLimit: 2,
        ThrottlingBurstLimit: 5,
      }),
    );
  });

  it.each(Object.entries(API_FUNCTIONS))(
    "caps %s's functions and quietens their logging and tracing",
    (name, prefixes) => {
      const template = stack(name);
      const functions = resources(
        template,
        'AWS::Lambda::Function',
        ...prefixes,
      );

      expect(functions).toHaveLength(prefixes.length);
      for (const fn of functions) {
        expect(fn).toMatchObject({
          ReservedConcurrentExecutions: 10,
          Environment: {
            Variables: {
              POWERTOOLS_LOG_LEVEL: 'WARN',
              POWERTOOLS_TRACE_ENABLED: 'false',
            },
          },
        });
        expect(fn).not.toHaveProperty('TracingConfig');
      }
      template.hasResourceProperties('AWS::ApiGateway::Stage', {
        TracingEnabled: false,
      });
    },
  );

  it("gives core-api's function a 10 second timeout", () => {
    expect(
      resources(
        stack('CoreApi'),
        'AWS::Lambda::Function',
        'CoreApiRouterHandler',
      ),
    ).toEqual([expect.objectContaining({ Timeout: 10 })]);
  });

  it("caps the core table's and its indexes' on-demand throughput", () => {
    const throughput = { MaxReadRequestUnits: 100, MaxWriteRequestUnits: 50 };
    const [table] = resources(
      stack('Data'),
      'AWS::DynamoDB::Table',
      'CoreTable',
    );

    expect(table).toMatchObject({ OnDemandThroughput: throughput });
    const indexes = (table as { GlobalSecondaryIndexes: object[] })
      .GlobalSecondaryIndexes;
    expect(indexes.length).toBeGreaterThan(0);
    for (const index of indexes) {
      expect(index).toMatchObject({ OnDemandThroughput: throughput });
    }
  });

  it('expires records by their ttl attribute (the analytics markers)', () => {
    stack('Data').hasResourceProperties('AWS::DynamoDB::Table', {
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
  });

  it('only lets an admin create users', () => {
    stack('Data').hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });
});

const CDK_INTERNAL =
  /^(Custom(S3AutoDeleteObjects|CrossRegionExportReader)CustomResourceProvider|.*Providerframework)/;

describe('local portal origins', () => {
  const stage = synth({});
  const every = localPortalOrigins('instructor', 'student', 'admin');
  const json = (template: Template, type: string) =>
    JSON.stringify(template.findResources(type));

  it('are all callback URLs of the user pool client', () => {
    const clients = Object.values(
      stage('Data').findResources('AWS::Cognito::UserPoolClient'),
    ) as { Properties: { CallbackURLs: unknown } }[];
    const callbacks = JSON.stringify(clients.map((c) => c.Properties));
    for (const origin of every) {
      expect(callbacks).toContain(origin);
    }
  });

  it.each([
    ['CoreApi', ['instructor', 'student', 'admin']],
    ['InstructorApi', ['instructor']],
    ['AdminApi', ['admin']],
  ] as const)("are all in %s's CORS allow-list", (name, portals) => {
    const functions = json(stage(name), 'AWS::Lambda::Function');
    expect(functions).toContain('ALLOWED_ORIGINS');
    for (const origin of localPortalOrigins(...portals)) {
      expect(functions).toContain(origin);
    }
  });
});

describe('Lambda functions', () => {
  const stack = synth({});

  it.each([
    'Websites',
    'Data',
    'Payments',
    'MediaPipeline',
    'CoreApi',
    'InstructorApi',
    'AdminApi',
    'RuntimeConfig',
  ])('all run on ARM in %s', (name) => {
    const functions = Object.entries(
      stack(name).findResources('AWS::Lambda::Function'),
    )
      // Functions CDK creates itself, which take no architecture: custom
      // resource provider frameworks, S3 auto-delete and the cross-region
      // export reader. They run only during deploys.
      .filter(([id]) => !CDK_INTERNAL.test(id))
      .map(([id, resource]) => ({
        id,
        architectures: (
          resource as { Properties: { Architectures?: string[] } }
        ).Properties.Architectures,
      }));

    expect(functions.length).toBeGreaterThan(0);
    for (const fn of functions) {
      expect(fn).toEqual({ id: fn.id, architectures: ['arm64'] });
    }
  });
});

describe('the site runtime config', () => {
  const siteOf = (studentPortal: object) =>
    RuntimeConfig.of(
      new ApplicationStage(new App(), 'discava-test', {
        env: { account: '111122223333', region: 'ap-southeast-2' },
        studentPortal,
      }).node.findChild('Websites'),
    )?.get('connection').site;

  it('names the site, with no organisation ID by default', () => {
    expect(siteOf({})).toEqual({ name: 'Discava' });
    expect(siteOf({ siteName: 'Acme Learn' })).toEqual({ name: 'Acme Learn' });
  });

  it('carries the LinkedIn organisation ID when the stage has one', () => {
    expect(siteOf({ linkedInOrganizationId: '12345' })).toEqual({
      name: 'Discava',
      linkedInOrganizationId: '12345',
    });
  });
});

describe("the portals' addresses (#235)", () => {
  it("gives every portal every portal's address, by its custom domain when it has one", () => {
    const stage = new ApplicationStage(new App(), 'discava-test', {
      env: { account: '111122223333', region: 'ap-southeast-2' },
      studentPortal: {
        domainNames: ['learn.example.com'],
        certificateArn:
          'arn:aws:acm:us-east-1:111122223333:certificate/00000000-0000-0000-0000-000000000000',
      },
    });
    const portals = RuntimeConfig.of(stage.node.findChild('Websites'))?.get(
      'connection',
    ).portals;

    expect(Object.keys(portals).sort()).toEqual([
      'AdminPortal',
      'InstructorPortal',
      'StudentPortal',
    ]);
    expect(portals.StudentPortal).toBe('https://learn.example.com');
    // Without a custom domain, its CloudFront domain (a token until deploy).
    expect(portals.InstructorPortal).toMatch(/^https:\/\/\$\{Token\[/);
  });
});

describe('the stream router', () => {
  const stack = synth({});

  // The mappings on the core table's stream: its stream ARN is exported from
  // Data, so a mapping on it refers to that export.
  const streamMappings = (components: StageComponents) =>
    stackTemplates(components).flatMap(([name, template]) =>
      Object.values(template.findResources('AWS::Lambda::EventSourceMapping'))
        .filter((m) =>
          JSON.stringify(m.Properties.EventSourceArn).includes('StreamArn'),
        )
        .map(() => name),
    );

  it('is the only reader of the core table stream', () => {
    expect(streamMappings({})).toEqual(['StreamRouter']);
  });

  it('keeps the old per-feature mappings and handlers out of CoreApi', () => {
    const template = stack('CoreApi');
    expect(template.findResources('AWS::Lambda::EventSourceMapping')).toEqual(
      {},
    );
    expect(Object.keys(template.findResources('AWS::SQS::Queue'))).toEqual([]);
    expect(
      Object.keys(template.findResources('AWS::Lambda::Function')).filter(
        (id) =>
          /^(ProgressRecalculation|SearchIndexing|AnalyticsUpdate)/.test(id),
      ),
    ).toEqual([]);
  });

  it('has a queue, failure queue, alarm and mapping per registered feature', () => {
    const template = stack('StreamRouter');
    const features = STREAM_FEATURES.length;
    // Each feature's queue and failure queue, the router's failures, and the
    // certificate reminder's.
    expect(Object.keys(template.findResources('AWS::SQS::Queue'))).toHaveLength(
      features * 2 + 2,
    );
    expect(
      Object.keys(template.findResources('AWS::CloudWatch::Alarm')),
    ).toHaveLength(features + 1);
    // Each feature's, and the router's from the stream.
    expect(
      Object.keys(template.findResources('AWS::Lambda::EventSourceMapping')),
    ).toHaveLength(features + 1);
  });

  it('gives analytics-update a queue, a failure queue, an alarm and a handler', () => {
    const template = stack('StreamRouter');
    for (const type of [
      'AWS::SQS::Queue',
      'AWS::CloudWatch::Alarm',
      'AWS::Lambda::Function',
    ]) {
      expect(
        Object.keys(template.findResources(type)).filter(
          (id) =>
            id.startsWith('StreamRouterAnalyticsUpdate') ||
            id.startsWith('AnalyticsUpdate'),
        ).length,
        type,
      ).toBeGreaterThan(0);
    }
    expect(
      Object.keys(template.findResources('AWS::SQS::Queue')).some((id) =>
        id.startsWith('StreamRouterAnalyticsUpdateFailures'),
      ),
    ).toBe(true);
  });

  it("applies the stage's encryption setting to the queues", () => {
    const development = synth(
      resolveStage('packages/infra', 'discava-development')?.infra ?? {},
    )('StreamRouter');
    expect(Object.keys(development.findResources('AWS::KMS::Key'))).toEqual([]);
    expect(
      Object.keys(stack('StreamRouter').findResources('AWS::KMS::Key')),
    ).toHaveLength(1);
  });

  it('keeps every stack under 450 resources (the cap is 500)', () => {
    for (const [name, template] of stackTemplates({})) {
      expect(
        Object.keys(template.toJSON().Resources ?? {}).length,
        name,
      ).toBeLessThan(450);
    }
  });
});

describe('notification delivery', () => {
  const SES_IDENTITY = 'example.com';
  const configured: StageComponents = {
    notifications: {
      fromAddress: 'notifications@example.com',
      sesIdentity: SES_IDENTITY,
    },
  };

  // Every IAM policy statement's actions of `type`, by the stack's role.
  const sesStatements = (components: StageComponents) =>
    stackTemplates(components).flatMap(([name, template]) =>
      Object.values(template.findResources('AWS::IAM::Policy')).flatMap(
        (policy) =>
          (
            policy.Properties.PolicyDocument.Statement as {
              Action: string | string[];
              Resource: unknown;
            }[]
          )
            .filter((statement) =>
              JSON.stringify(statement.Action).includes('ses:'),
            )
            .map((statement) => ({ name, statement })),
      ),
    );

  const secretReaders = (components: StageComponents) =>
    stackTemplates(components).flatMap(([name, template]) =>
      Object.entries(template.findResources('AWS::IAM::Policy'))
        .filter(([, policy]) =>
          JSON.stringify(policy.Properties.PolicyDocument).includes(
            'NotificationUnsubscribeSecret',
          ),
        )
        .map(([id]) => `${name}/${id}`),
    );

  const deliveryFunction = (components: StageComponents) => {
    const template = synth(components)('StreamRouter');
    const [fn] = resources(
      template,
      'AWS::Lambda::Function',
      'NotificationDelivery',
    );
    return fn as { Timeout: number; Environment: { Variables: object } };
  };

  it('has a queue, failure queue and alarm of its own, and still one stream mapping', () => {
    const template = synth({})('StreamRouter');
    for (const type of ['AWS::SQS::Queue', 'AWS::CloudWatch::Alarm']) {
      expect(
        Object.keys(template.findResources(type)).filter((id) =>
          id.startsWith('StreamRouterNotificationDelivery'),
        ).length,
        type,
      ).toBeGreaterThan(0);
    }
    expect(
      Object.keys(template.findResources('AWS::SQS::Queue')).some((id) =>
        id.startsWith('StreamRouterNotificationDeliveryFailures'),
      ),
    ).toBe(true);
    expect(
      stackTemplates({}).flatMap(([name, t]) =>
        Object.values(t.findResources('AWS::Lambda::EventSourceMapping'))
          .filter((m) =>
            JSON.stringify(m.Properties.EventSourceArn).includes('StreamArn'),
          )
          .map(() => name),
      ),
    ).toEqual(['StreamRouter']);
  });

  it('gives the queue a visibility timeout of six times the function timeout', () => {
    const template = synth({})('StreamRouter');
    const { Timeout } = deliveryFunction({});
    expect(Timeout).toBe(120);
    const queues = resources(
      template,
      'AWS::SQS::Queue',
      'StreamRouterNotificationDelivery',
    ).filter((queue) => queue.RedrivePolicy);
    expect(queues).toHaveLength(1);
    expect(queues[0].VisibilityTimeout).toBe(Timeout * 6);
  });

  it('is told where the portals and the API are, and where its secret is', () => {
    const { Environment } = deliveryFunction(configured);
    expect(Object.keys(Environment.Variables).sort()).toEqual(
      [
        'ADMIN_PORTAL_URL',
        'CORE_API_URL',
        'INSTRUCTOR_PORTAL_URL',
        'DISCAVA_DYNAMODB_CORE_TABLE',
        'NOTIFICATIONS_FROM_ADDRESS',
        'STUDENT_PORTAL_URL',
        'UNSUBSCRIBE_SECRET_ARN',
      ].sort(),
    );
    expect(Environment.Variables).toMatchObject({
      NOTIFICATIONS_FROM_ADDRESS: 'notifications@example.com',
    });
  });

  it('points at the custom domains when the stage has them', () => {
    const { Environment } = deliveryFunction({
      studentPortal: {
        domainNames: ['learn.example.com'],
        certificateArn:
          'arn:aws:acm:us-east-1:111122223333:certificate/00000000-0000-0000-0000-000000000000',
      },
      coreApi: {
        domainName: 'api.example.com',
        certificateArn:
          'arn:aws:acm:ap-southeast-2:111122223333:certificate/00000000-0000-0000-0000-000000000000',
      },
    });
    expect(Environment.Variables).toMatchObject({
      STUDENT_PORTAL_URL: 'https://learn.example.com',
      CORE_API_URL: 'https://api.example.com',
    });
  });

  it('is given no sender and no SES access when the stage configures none', () => {
    expect(deliveryFunction({}).Environment.Variables).not.toHaveProperty(
      'NOTIFICATIONS_FROM_ADDRESS',
    );
    expect(sesStatements({})).toEqual([]);
  });

  it('may send only from the configured address, and no other function may send', () => {
    const statements = sesStatements(configured);
    expect(statements).toHaveLength(1);
    expect(statements[0].name).toBe('StreamRouter');
    expect(statements[0].statement.Action).toBe('ses:SendEmail');
    // Every identity, since in the SES sandbox the recipients' verified
    // identities are authorised too; the condition pins the sender.
    expect(statements[0].statement.Resource).toEqual({
      'Fn::Join': [
        '',
        [
          'arn:',
          { Ref: 'AWS::Partition' },
          ':ses:ap-southeast-2:111122223333:identity/*',
        ],
      ],
    });
    expect(statements[0].statement.Condition).toEqual({
      StringEquals: { 'ses:FromAddress': 'notifications@example.com' },
    });
  });

  it('is read by the delivery and unsubscribe functions only', () => {
    const readers = secretReaders({});
    expect(readers).toHaveLength(2);
    expect(readers.sort()).toEqual([
      expect.stringMatching(/^CoreApi\/NotificationUnsubscribe/),
      expect.stringMatching(/^StreamRouter\/NotificationDelivery/),
    ]);
  });

  it('keeps the stage under the resource cap', () => {
    for (const [name, template] of stackTemplates(configured)) {
      expect(
        Object.keys(template.toJSON().Resources ?? {}).length,
        name,
      ).toBeLessThan(450);
    }
  });
});

describe('limits a stage leaves out', () => {
  const stack = synth({});

  it('default to 100/s per method and 20/s for the public ones', () => {
    const settings = methodSettings(stack('CoreApi'));

    expect(settings).toContainEqual(
      expect.objectContaining({
        ResourcePath: '/*',
        ThrottlingRateLimit: 100,
        ThrottlingBurstLimit: 200,
      }),
    );
    expect(settings).toContainEqual(
      expect.objectContaining({
        ResourcePath: '/~1course.publicList',
        ThrottlingRateLimit: 20,
        ThrottlingBurstLimit: 40,
      }),
    );
  });

  it('leave functions unreserved, traced and at their own timeout', () => {
    const [fn] = resources(
      stack('CoreApi'),
      'AWS::Lambda::Function',
      'CoreApiRouterHandler',
    );

    expect(fn).not.toHaveProperty('ReservedConcurrentExecutions');
    expect(fn).toMatchObject({
      Timeout: 30,
      TracingConfig: { Mode: 'Active' },
    });
  });

  it('leave the table without a throughput maximum', () => {
    stack('Data').hasResourceProperties('AWS::DynamoDB::Table', {
      OnDemandThroughput: Match.absent(),
    });
  });

  it('let people sign themselves up', () => {
    stack('Data').hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
    });
  });
});

describe('payments (the Stripe webhook and checkout)', () => {
  const stack = synth({});
  const policiesOf = (template: Template, rolePrefix: string) =>
    Object.values(template.findResources('AWS::IAM::Policy'))
      .filter((policy) =>
        (policy.Properties.Roles as { Ref: string }[]).some((role) =>
          role.Ref.startsWith(rolePrefix),
        ),
      )
      .map((policy) => JSON.stringify(policy.Properties.PolicyDocument));

  it('has a Payments stack that orders after Data', () => {
    const app = new App();
    const stage = new ApplicationStage(app, 'discava-test', {
      env: { account: '111122223333', region: 'ap-southeast-2' },
    });
    const names = stage.node.children.map((child) => child.node.id);
    expect(names).toContain('Payments');
    const payments = stage.node.findChild('Payments') as Stack;
    // References between stacks become dependencies when the app synthesizes.
    app.synth();
    const dependencies = payments.dependencies.map((d) => d.node.id);
    expect(dependencies).toContain('Data');
    // The first full synth of the stage in the file: it took 31 to 35 s on a
    // loaded CI runner (3 s locally), past the 30 s default.
  }, 90_000);

  it('serves POST /stripe/webhook as the only method, with no authorizer', () => {
    const template = stack('Payments');
    const methods = Object.values(
      template.findResources('AWS::ApiGateway::Method'),
    ).map((m) => m.Properties);
    expect(methods).toHaveLength(1);
    expect(methods[0]).toMatchObject({
      HttpMethod: 'POST',
      AuthorizationType: 'NONE',
    });
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      PathPart: 'webhook',
    });
    expect(
      Object.keys(template.findResources('AWS::ApiGateway::Authorizer')),
    ).toEqual([]);
  });

  it('puts the stage WAF in front of it by default, and none when the stage turns it off', () => {
    expect(
      Object.keys(stack('Payments').findResources('AWS::WAFv2::WebACL')),
    ).toHaveLength(1);
    const off = synth({ payments: { enableWaf: false } })('Payments');
    expect(Object.keys(off.findResources('AWS::WAFv2::WebACL'))).toEqual([]);
  });

  it('throttles the method as the stage says', () => {
    const settings = methodSettings(
      synth({ payments: { throttleRateLimit: 3, throttleBurstLimit: 7 } })(
        'Payments',
      ),
    );
    expect(settings).toContainEqual(
      expect.objectContaining({
        ThrottlingRateLimit: 3,
        ThrottlingBurstLimit: 7,
      }),
    );
  });

  it("gives the webhook's role the table and the two secrets, and no write to either secret", () => {
    const policies = policiesOf(
      stack('Payments'),
      'StripeWebhookApiHandler',
    ).join('');
    expect(policies).toContain('dynamodb:PutItem');
    expect(policies).toContain('ApiKey');
    expect(policies).toContain('WebhookSigningSecret');
    expect(policies).not.toContain('secretsmanager:PutSecretValue');
  });

  it('gives the checkout function the API key and not the webhook secret', () => {
    const coreApi = stack('CoreApi');
    const policies = policiesOf(coreApi, 'CoreApiPaymentsCheckoutHandler').join(
      '',
    );
    expect(policies).toContain('ApiKey');
    expect(policies).not.toContain('WebhookSigningSecret');
    const [fn] = resources(
      coreApi,
      'AWS::Lambda::Function',
      'CoreApiPaymentsCheckoutHandler',
    );
    const variables = JSON.stringify(
      (fn as { Environment: { Variables: object } }).Environment.Variables,
    );
    expect(variables).toContain('STRIPE_API_KEY_SECRET_ARN');
    expect(variables).not.toContain('STRIPE_WEBHOOK_SECRET_ARN');
  });

  it('gives the payouts function of instructor-api the API key to read, and neither write nor the signing secret', () => {
    const instructorApi = stack('InstructorApi');
    const policies = policiesOf(
      instructorApi,
      'InstructorApiPayoutsHandler',
    ).join('');
    expect(policies).toContain('ApiKey');
    expect(policies).toContain('secretsmanager:GetSecretValue');
    expect(policies).not.toContain('WebhookSigningSecret');
    expect(policies).not.toContain('secretsmanager:PutSecretValue');
    const [fn] = resources(
      instructorApi,
      'AWS::Lambda::Function',
      'InstructorApiPayoutsHandler',
    );
    const variables = JSON.stringify(
      (fn as { Environment: { Variables: object } }).Environment.Variables,
    );
    expect(variables).toContain('STRIPE_API_KEY_SECRET_ARN');
    expect(variables).not.toContain('STRIPE_WEBHOOK_SECRET_ARN');
  });

  it("keeps the Stripe key out of instructor-api's shared router function", () => {
    const policies = policiesOf(
      stack('InstructorApi'),
      'InstructorApiRouterHandler',
    ).join('');
    expect(policies).not.toContain('ApiKey');
  });

  it('lets no role but the admin connect function write either secret', () => {
    for (const [name, template] of stackTemplates({})) {
      for (const [role, actions] of Object.entries(actionsByRole(template))) {
        if (!actions.includes('secretsmanager:PutSecretValue')) continue;
        expect(`${name}/${role}`, 'writes a Stripe secret').toMatch(
          /^AdminApi\/AdminApiPaymentsConnectHandler/,
        );
      }
    }
  });

  it('tells the connect function and the shared admin router the webhook address', () => {
    const functions = JSON.stringify(
      stack('AdminApi').findResources('AWS::Lambda::Function'),
    );
    expect(functions.match(/STRIPE_WEBHOOK_URL/g)?.length).toBe(2);
  });
});

describe('earnings recording', () => {
  const recordingFunction = (payouts?: {
    platformFeeBasisPoints: number;
    holdDays: number;
  }) => {
    const [fn] = resources(
      synth({ payouts })('StreamRouter'),
      'AWS::Lambda::Function',
      'EarningsRecording',
    );
    return fn as { Environment: { Variables: Record<string, string> } };
  };

  it('has a queue, failure queue and alarm of its own, and still one stream mapping', () => {
    const template = synth({})('StreamRouter');
    for (const type of ['AWS::SQS::Queue', 'AWS::CloudWatch::Alarm']) {
      expect(
        Object.keys(template.findResources(type)).filter((id) =>
          id.startsWith('StreamRouterEarningsRecording'),
        ).length,
        type,
      ).toBeGreaterThan(0);
    }
    expect(
      Object.keys(template.findResources('AWS::SQS::Queue')).some((id) =>
        id.startsWith('StreamRouterEarningsRecordingFailures'),
      ),
    ).toBe(true);
    expect(
      stackTemplates({}).flatMap(([name, t]) =>
        Object.values(t.findResources('AWS::Lambda::EventSourceMapping'))
          .filter((m) =>
            JSON.stringify(m.Properties.EventSourceArn).includes('StreamArn'),
          )
          .map(() => name),
      ),
    ).toEqual(['StreamRouter']);
  });

  it("is invoked only by its feature's queue", () => {
    const template = synth({})('StreamRouter');
    const mappings = Object.values(
      template.findResources('AWS::Lambda::EventSourceMapping'),
    ).filter((m) =>
      JSON.stringify(m.Properties.FunctionName).includes('EarningsRecording'),
    );
    expect(mappings).toHaveLength(1);
    expect(JSON.stringify(mappings[0].Properties.EventSourceArn)).toContain(
      'StreamRouterEarningsRecordingQueue',
    );
  });

  it("carries the stage's fee and hold", () => {
    expect(
      recordingFunction({ platformFeeBasisPoints: 1500, holdDays: 7 })
        .Environment.Variables,
    ).toMatchObject({
      PLATFORM_FEE_BASIS_POINTS: '1500',
      PAYOUT_HOLD_DAYS: '7',
    });
  });

  it('reads and writes the table and reads no secret', () => {
    const actions = actionsOf(
      synth({})('StreamRouter'),
      'EarningsRecordingServiceRole',
    );
    expect(actions).toContain('dynamodb:PutItem');
    expect(actions).not.toContain('secretsmanager:GetSecretValue');
  });
});

describe('payout run', () => {
  const stack = synth({});
  const policiesOf = (template: Template, rolePrefix: string) =>
    Object.values(template.findResources('AWS::IAM::Policy'))
      .filter((policy) =>
        JSON.stringify(policy.Properties.Roles).includes(rolePrefix),
      )
      .map((policy) => JSON.stringify(policy.Properties.PolicyDocument));
  const runFunction = (payouts?: {
    platformFeeBasisPoints: number;
    holdDays: number;
    minimumPayoutMinor: number;
  }) => {
    const [fn] = resources(
      synth({ payouts })('Payouts'),
      'AWS::Lambda::Function',
      'PayoutRun',
    );
    return fn as { Environment: { Variables: Record<string, string> } };
  };

  it('has a stack of its own that orders after Data', () => {
    const app = new App();
    const stage = new ApplicationStage(app, 'discava-test', {
      env: { account: '111122223333', region: 'ap-southeast-2' },
    });
    const payouts = stage.node.findChild('Payouts') as Stack;
    app.synth();
    expect(payouts.dependencies.map((d) => d.node.id)).toContain('Data');
  });

  it('runs once a day', () => {
    const rules = Object.values(
      stack('Payouts').findResources('AWS::Events::Rule'),
    );
    expect(rules).toHaveLength(1);
    expect(rules[0].Properties.ScheduleExpression).toBe('rate(1 day)');
    expect(JSON.stringify(rules[0].Properties.Targets)).toContain('PayoutRun');
  });

  it('carries the stage minimum, defaulting to 1000', () => {
    expect(runFunction().Environment.Variables.PAYOUT_MINIMUM_MINOR).toBe(
      '1000',
    );
    expect(
      runFunction({
        platformFeeBasisPoints: 1500,
        holdDays: 7,
        minimumPayoutMinor: 2500,
      }).Environment.Variables.PAYOUT_MINIMUM_MINOR,
    ).toBe('2500');
  });

  it('reads the API key but neither writes it nor reads the signing secret', () => {
    const policies = policiesOf(stack('Payouts'), 'PayoutRun').join('');
    expect(policies).toContain('ApiKey');
    expect(policies).toContain('secretsmanager:GetSecretValue');
    expect(policies).not.toContain('WebhookSigningSecret');
    expect(policies).not.toContain('secretsmanager:PutSecretValue');
    const variables = JSON.stringify(runFunction().Environment.Variables);
    expect(variables).toContain('STRIPE_API_KEY_SECRET_ARN');
    expect(variables).not.toContain('STRIPE_WEBHOOK_SECRET_ARN');
  });

  it('has no stream or queue event source', () => {
    expect(
      Object.keys(
        stack('Payouts').findResources('AWS::Lambda::EventSourceMapping'),
      ),
    ).toEqual([]);
  });
});

describe('AppConfig readers', () => {
  it('leaves no function in any stack able to read AppConfig', () => {
    const readers = stackTemplates({}).flatMap(([name, template]) =>
      functionsReadingAppConfig(template).map((id) => `${name}/${id}`),
    );
    expect(readers).toEqual([]);
  });
});
