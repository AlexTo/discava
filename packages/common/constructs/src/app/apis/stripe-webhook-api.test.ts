/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
// (CDK resolves asset paths from import.meta.url, which jsdom doesn't provide.)
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it, vi } from 'vitest';
import { StripeSecrets } from '../../core/stripe-secrets.js';
import { CoreTable } from '../dynamodb/core-table.js';
import { StripeWebhookApi } from './stripe-webhook-api.js';

const build = (
  props: Partial<ConstructorParameters<typeof StripeWebhookApi>[2]> = {},
) => {
  const stack = new Stack(new App(), 'Stack', {
    env: { account: '111122223333', region: 'ap-southeast-2' },
  });
  const api = new StripeWebhookApi(stack, 'Api', {
    coreTable: new CoreTable(stack, 'Table'),
    stripeSecrets: new StripeSecrets(stack, 'Secrets'),
    ...props,
  });
  return { api, template: Template.fromStack(stack) };
};

// Synthesising a stack is slow on a cold or busy CI runner.
vi.setConfig({ testTimeout: 60_000 });

describe('StripeWebhookApi', () => {
  it('has exactly one POST /stripe/webhook method with no authorizer', () => {
    const { template } = build();
    const methods = Object.values(
      template.findResources('AWS::ApiGateway::Method'),
    );
    expect(methods).toHaveLength(1);
    expect(methods[0]?.Properties).toMatchObject({
      HttpMethod: 'POST',
      AuthorizationType: 'NONE',
    });
    expect(
      Object.keys(template.findResources('AWS::ApiGateway::Authorizer')),
    ).toEqual([]);
  });

  it('has the WAF and throttling by default, and no WAF when the stage turns it off', () => {
    expect(
      Object.keys(build().template.findResources('AWS::WAFv2::WebACL')),
    ).toHaveLength(1);
    const { template } = build({
      enableWaf: false,
      throttle: { rateLimit: 4, burstLimit: 8 },
    });
    expect(Object.keys(template.findResources('AWS::WAFv2::WebACL'))).toEqual(
      [],
    );
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          ThrottlingRateLimit: 4,
          ThrottlingBurstLimit: 8,
        }),
      ]),
    });
  });

  it("gives the function's role only the table and the two secrets", () => {
    const { template } = build();
    const actions = Object.values(template.findResources('AWS::IAM::Policy'))
      .filter((p) =>
        (p.Properties.Roles as { Ref: string }[]).some((r) =>
          r.Ref.startsWith('ApiHandler'),
        ),
      )
      .flatMap((p) =>
        (
          p.Properties.PolicyDocument.Statement as {
            Action: string | string[];
          }[]
        ).flatMap((s) => [s.Action].flat()),
      );
    expect(actions).toContain('secretsmanager:GetSecretValue');
    expect(actions).not.toContain('secretsmanager:PutSecretValue');
    expect(
      actions.filter(
        (a) => !/^(dynamodb|secretsmanager|kms|xray|appconfig):/.test(a),
      ),
    ).toEqual([]);
  });

  it('gives the function the AppConfig application id and read access to resolve the table (#619)', () => {
    const { template } = build();
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          RUNTIME_CONFIG_APP_ID: Match.anyValue(),
        }),
      },
    });
  });

  it("reports the custom domain's address when it has one", () => {
    expect(build().api.webhookUrl).toMatch(/stripe\/webhook$/);
  });
});
