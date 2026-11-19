/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node

import { type StageComponents } from '@discava/common-infra-config';
import { describe, expect, it } from 'vitest';
import { actionsOf, resources, synth } from './stack-test-fixture.js';

describe("core-api's functions", () => {
  const template = synth({})('CoreApi');

  it('give only the video URL function the CloudFront signing key', () => {
    const roles = Object.values(template.findResources('AWS::IAM::Policy'))
      .flatMap((resource) => {
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
        // The unsubscribe function reads its own secret, not the signing key.
      })
      .filter((role) => !role.startsWith('NotificationUnsubscribe'));

    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatch(/^CoreApiMediaUrlHandlerServiceRole/);
  });
});

describe('submitting to an assignment (#102)', () => {
  const stack = synth({});
  const coreApi = stack('CoreApi');

  it('serves uploadUrl and submit from a function of their own', () => {
    expect(
      resources(
        coreApi,
        'AWS::Lambda::Function',
        'CoreApiAssignmentSubmitHandler',
      ),
    ).toHaveLength(1);
  });

  it('gives that function S3 and Scheduler rights, and the shared router none', () => {
    const submit = actionsOf(
      coreApi,
      'CoreApiAssignmentSubmitHandlerServiceRole',
    );
    expect(submit).toEqual(
      expect.arrayContaining([
        's3:PutObject',
        's3:GetObject*',
        's3:DeleteObject*',
        'scheduler:CreateSchedule',
        'iam:PassRole',
      ]),
    );

    const router = actionsOf(coreApi, 'CoreApiRouterHandlerServiceRole');
    for (const action of submit.filter((a) => /^(s3|scheduler|iam):/.test(a))) {
      expect(router).not.toContain(action);
    }
  });

  it('reads AppConfig and the table like every core-api function, with no signing key', () => {
    const submit = actionsOf(
      coreApi,
      'CoreApiAssignmentSubmitHandlerServiceRole',
    );
    expect(submit).toEqual(
      expect.arrayContaining(['appconfig:GetLatestConfiguration']),
    );
    expect(submit).toEqual(expect.arrayContaining(['dynamodb:GetItem']));
    expect(submit).not.toContain('secretsmanager:GetSecretValue');
  });

  it('times out at 25 seconds, below the gateway’s 29', () => {
    expect(
      resources(
        coreApi,
        'AWS::Lambda::Function',
        'CoreApiAssignmentSubmitHandler',
      ),
    ).toEqual([expect.objectContaining({ Timeout: 25 })]);
  });

  it('times out at 25 seconds even when the stage sets a longer one', () => {
    const longer = synth({
      coreApi: { timeoutSeconds: 120 },
    } as unknown as StageComponents)('CoreApi');

    expect(
      resources(
        longer,
        'AWS::Lambda::Function',
        'CoreApiAssignmentSubmitHandler',
      ),
    ).toEqual([expect.objectContaining({ Timeout: 25 })]);
    expect(
      resources(longer, 'AWS::Lambda::Function', 'CoreApiRouterHandler'),
    ).toEqual([expect.objectContaining({ Timeout: 120 })]);
  });

  it('lets the cleanup Lambda read the core table, and not write it', () => {
    const cleanup = actionsOf(
      stack('MediaPipeline'),
      'TranscodeCleanupServiceRole',
    );

    expect(cleanup).toEqual(expect.arrayContaining(['dynamodb:GetItem']));
    for (const write of [
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
    ]) {
      expect(cleanup).not.toContain(write);
    }
  });
});

describe('the unsubscribe route', () => {
  const template = synth({})('CoreApi');
  const resourceIds = (pathPart: string) =>
    Object.entries(template.findResources('AWS::ApiGateway::Resource'))
      .filter(([, r]) => r.Properties.PathPart === pathPart)
      .map(([id]) => id);
  const methodsOn = (httpMethod: string, pathPart: string) =>
    Object.values(template.findResources('AWS::ApiGateway::Method')).filter(
      (m) =>
        m.Properties.HttpMethod === httpMethod &&
        resourceIds(pathPart).some((id) =>
          JSON.stringify(m.Properties.ResourceId).includes(id),
        ),
    );

  it('serves a public GET and POST on unsubscribe/{token} from the unsubscribe function', () => {
    const [functionId] = Object.keys(
      template.findResources('AWS::Lambda::Function'),
    ).filter((id) => id.startsWith('NotificationUnsubscribe'));
    expect(functionId).toBeDefined();
    for (const httpMethod of ['GET', 'POST']) {
      const [method] = methodsOn(httpMethod, '{token}');
      expect(method.Properties.AuthorizationType).toBe('NONE');
      expect(JSON.stringify(method.Properties.Integration.Uri)).toContain(
        functionId,
      );
    }
  });

  it('adds exactly those two routes to the API', () => {
    const operations = Object.values(
      template.findResources('AWS::ApiGateway::Method'),
    ).filter((m) => m.Properties.HttpMethod !== 'OPTIONS');
    const onToken = ['GET', 'POST'].flatMap((m) => methodsOn(m, '{token}'));
    expect(onToken).toHaveLength(2);
    // The router's operations are the rest.
    expect(operations.length - onToken.length).toBeGreaterThan(0);
  });

  it('gives it the table and the secret, and not the shared router function', () => {
    const roleStatements = (prefix: string) =>
      JSON.stringify(
        Object.entries(template.findResources('AWS::IAM::Policy'))
          .filter(([id]) => id.startsWith(prefix))
          .map(([, p]) => p.Properties.PolicyDocument),
      );
    const own = roleStatements(
      'NotificationUnsubscribeServiceRoleDefaultPolicy',
    );
    expect(own).toContain('secretsmanager:GetSecretValue');
    expect(own).toContain('dynamodb:');
    expect(roleStatements('CoreApiRouterHandler')).not.toContain(
      'secretsmanager:GetSecretValue',
    );
  });
});
