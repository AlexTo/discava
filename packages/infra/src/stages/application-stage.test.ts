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
import { PROGRESS_STREAM_FILTERS } from '@discava/core-table';
import { App, type Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { ApplicationStage } from './application-stage.js';

// Synthesizes the application with a stage's settings and returns each of
// its stacks' templates.
const synth = (components: StageComponents) => {
  const stage = new ApplicationStage(new App(), 'discava-test', {
    env: { account: '111122223333', region: 'ap-southeast-2' },
    ...components,
  });
  return (name: string) =>
    Template.fromStack(stage.node.findChild(name) as Stack);
};

// The resources of `type` whose logical id starts with one of `prefixes`.
const resources = (
  template: Template,
  type: string,
  ...prefixes: string[]
): Record<string, unknown>[] =>
  Object.entries(template.findResources(type))
    .filter(([id]) => prefixes.some((prefix) => id.startsWith(prefix)))
    .map(([, resource]) => (resource as { Properties: object }).Properties);

const methodSettings = (template: Template) =>
  Object.values(template.findResources('AWS::ApiGateway::Stage')).flatMap(
    (stage) =>
      (stage as { Properties: { MethodSettings?: object[] } }).Properties
        .MethodSettings ?? [],
  );

const API_FUNCTIONS = {
  CoreApi: ['CoreApiRouterHandler', 'CoreApiMediaUrlHandler'],
  InstructorApi: [
    'InstructorApiRouterHandler',
    'InstructorApiMediaUrlHandler',
    'InstructorApiMediaHandler',
    'InstructorApiCourseImageHandler',
  ],
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

  it('only lets an admin create users', () => {
    stack('Data').hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });
});

describe("core-api's functions", () => {
  const template = synth({})('CoreApi');

  it('give only the video URL function the CloudFront signing key', () => {
    const roles = Object.values(
      template.findResources('AWS::IAM::Policy'),
    ).flatMap((resource) => {
      const { PolicyDocument, Roles } = (
        resource as {
          Properties: {
            PolicyDocument: { Statement: { Action: string | string[] }[] };
            Roles: { Ref: string }[];
          };
        }
      ).Properties;
      const readsSecrets = PolicyDocument.Statement.some((statement) =>
        [statement.Action].flat().includes('secretsmanager:GetSecretValue'),
      );
      return readsSecrets ? Roles.map((role) => role.Ref) : [];
    });

    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatch(/^CoreApiMediaUrlHandlerServiceRole/);
  });
});

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

  it('lets only the instructor portal upload', () => {
    const buckets = Object.entries(data.findResources('AWS::S3::Bucket'));
    const [, upload] = buckets.find(([id]) =>
      id.startsWith('LessonMediaUploadBucket'),
    )!;
    const allowed = origins(
      (upload as { Properties: { CorsConfiguration: unknown } }).Properties
        .CorsConfiguration,
    );

    expect(allowed).toMatch(/InstructorPortal/);
    expect(allowed).not.toMatch(/StudentPortal/);
    expect(allowed).not.toContain('localhost:4201');
  });
});

const CDK_INTERNAL =
  /^(Custom(S3AutoDeleteObjects|CrossRegionExportReader)CustomResourceProvider|.*Providerframework)/;

describe('Lambda functions', () => {
  const stack = synth({});

  it.each([
    'Websites',
    'Data',
    'MediaPipeline',
    'CoreApi',
    'InstructorApi',
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

describe('progress recalculation', () => {
  const stack = synth({});

  // Local dev's event runner filters the stream with the same definition
  // (#137), so what triggers a recalculation can't differ between the two.
  it('is triggered by exactly the shared progress stream filters', () => {
    const mappings = Object.values(
      stack('CoreApi').findResources('AWS::Lambda::EventSourceMapping'),
    ) as {
      Properties: { FilterCriteria?: { Filters: { Pattern: string }[] } };
    }[];
    const patterns = mappings.flatMap(
      ({ Properties }) =>
        Properties.FilterCriteria?.Filters.map(({ Pattern }) =>
          JSON.parse(Pattern),
        ) ?? [],
    );

    expect(patterns).toEqual(
      PROGRESS_STREAM_FILTERS.map(({ eventName, image, entities }) => ({
        eventName: [eventName],
        dynamodb: { [image]: { __edb_e__: { S: [...entities] } } },
      })),
    );
  });
});

describe('course images (#76)', () => {
  const stack = synth({});

  // Actions on the public media bucket, per instructor-api function.
  const publicMediaActions = () => {
    const template = stack('InstructorApi');
    const roles = Object.fromEntries(
      Object.entries(template.findResources('AWS::Lambda::Function')).map(
        ([id, fn]) => [
          JSON.stringify(
            (fn as { Properties: { Role: unknown } }).Properties.Role,
          ),
          id,
        ],
      ),
    );
    const actions: Record<string, string[]> = {};
    for (const policy of Object.values(
      template.findResources('AWS::IAM::Policy'),
    ) as {
      Properties: {
        Roles: { Ref: string }[];
        PolicyDocument: {
          Statement: { Action: string | string[]; Resource: unknown }[];
        };
      };
    }[]) {
      const fn =
        roles[
          JSON.stringify({
            'Fn::GetAtt': [policy.Properties.Roles[0].Ref, 'Arn'],
          })
        ];
      for (const statement of policy.Properties.PolicyDocument.Statement) {
        if (JSON.stringify(statement.Resource).includes('PublicMediaBucket')) {
          (actions[fn] ??= []).push(...[statement.Action].flat());
        }
      }
    }
    return actions;
  };

  it('lets only the course image function upload and tag images', () => {
    const actions = publicMediaActions();

    expect(Object.keys(actions)).toEqual([
      expect.stringMatching(/^InstructorApiCourseImageHandler/),
    ]);
    expect(Object.values(actions)[0]).toEqual(
      expect.arrayContaining([
        's3:PutObject',
        's3:PutObjectTagging',
        's3:DeleteObjectTagging',
      ]),
    );
  });

  it.each(['StudentPortal', 'InstructorPortal'])(
    'lets the %s show them, and the crop preview',
    (portal) => {
      const policies = Object.entries(
        stack('Websites').findResources(
          'AWS::CloudFront::ResponseHeadersPolicy',
        ),
      )
        .filter(([id]) => id.startsWith(portal))
        .map(
          ([, policy]) =>
            (
              policy as {
                Properties: {
                  ResponseHeadersPolicyConfig: {
                    SecurityHeadersConfig: {
                      ContentSecurityPolicy: { ContentSecurityPolicy: string };
                    };
                  };
                };
              }
            ).Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig
              .ContentSecurityPolicy.ContentSecurityPolicy,
        );

      expect(policies).toHaveLength(1);
      const directives = Object.fromEntries(
        policies[0].split('; ').map((d) => [d.split(' ')[0], d]),
      );
      expect(directives['img-src']).toBe("img-src 'self' data: blob: https:");
      // Scripts stay limited to the portal itself.
      expect(directives['script-src']).toBe("script-src 'self'");
    },
  );

  it('serves images without signing', () => {
    const distributions = Object.entries(
      stack('Data').findResources('AWS::CloudFront::Distribution'),
    ).filter(([id]) => id.startsWith('PublicMediaBucket'));

    expect(distributions).toHaveLength(1);
    expect(
      JSON.stringify(distributions[0][1]).includes('TrustedKeyGroups'),
    ).toBe(false);
  });
});

describe('the media pipeline’s safety nets (#125, #185)', () => {
  const media = synth({})('MediaPipeline');
  const functionIdOf = (prefix: string) =>
    Object.keys(media.findResources('AWS::Lambda::Function')).find((id) =>
      id.startsWith(prefix),
    )!;

  it.each(['TranscodeComplete', 'TranscodeCleanup'])(
    'keeps events %s keeps failing in a queue',
    (name) => {
      media.hasResourceProperties('AWS::Lambda::EventInvokeConfig', {
        FunctionName: { Ref: functionIdOf(name) },
        MaximumRetryAttempts: 2,
        DestinationConfig: {
          OnFailure: {
            Destination: {
              'Fn::GetAtt': [Match.stringLikeRegexp(`^${name}Failures`), 'Arn'],
            },
          },
        },
      });
    },
  );

  it('keeps MediaConvert events EventBridge couldn’t deliver', () => {
    media.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({ source: ['aws.mediaconvert'] }),
      Targets: [
        Match.objectLike({
          DeadLetterConfig: {
            Arn: {
              'Fn::GetAtt': [
                Match.stringLikeRegexp('^TranscodeCompleteFailures'),
                'Arn',
              ],
            },
          },
        }),
      ],
    });
  });

  it('reconciles stuck videos every 30 minutes, asking MediaConvert about their jobs', () => {
    media.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(30 minutes)',
      Targets: [
        Match.objectLike({
          Arn: {
            'Fn::GetAtt': [functionIdOf('TranscodeReconciler'), 'Arn'],
          },
        }),
      ],
    });
    media.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: 'mediaconvert:GetJob' }),
        ]),
      },
      Roles: [
        { Ref: Match.stringLikeRegexp('^TranscodeReconcilerServiceRole') },
      ],
    });
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
