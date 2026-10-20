/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import {
  resolveStage,
  type StageComponents,
} from '@discava/common-infra-config';
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
  CoreApi: ['CoreApiRouterHandler'],
  InstructorApi: [
    'InstructorApiRouterHandler',
    'InstructorApiVideoUrlHandler',
    'InstructorApiMediaHandler',
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
