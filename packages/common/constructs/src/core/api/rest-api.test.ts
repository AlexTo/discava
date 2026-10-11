/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
// (CDK resolves asset paths from import.meta.url, which jsdom doesn't provide.)
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MockIntegration } from 'aws-cdk-lib/aws-apigateway';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { describe, expect, it } from 'vitest';
import { RuntimeConfig } from '../runtime-config.js';
import { RestApi } from './rest-api.js';

type Operations = 'ping';

const buildIntegrations = () => ({
  ping: {
    integration: new MockIntegration({
      integrationResponses: [{ statusCode: '200' }],
      requestTemplates: { 'application/json': '{"statusCode": 200}' },
    }),
  },
});

const buildApi = (domainName?: string) => {
  const stack = new Stack(new App(), 'Stack', {
    env: { account: 'test-account', region: 'ap-southeast-2' },
  });
  const api = new RestApi<Operations, ReturnType<typeof buildIntegrations>>(
    stack,
    'Api',
    {
      apiName: 'TestApi',
      operations: { ping: { path: '/ping', method: 'GET' } },
      integrations: buildIntegrations(),
      enableWaf: false,
      ...(domainName
        ? {
            domainName: {
              domainName,
              certificate: Certificate.fromCertificateArn(
                stack,
                'Cert',
                'arn:aws:acm:ap-southeast-2:123456789012:certificate/abc',
              ),
            },
          }
        : {}),
    },
  );
  return { stack, api };
};

/** The stack's custom domain alias outputs, keyed by logical ID. */
const aliasOutputs = (stack: Stack) =>
  Object.fromEntries(
    Object.entries(Template.fromStack(stack).findOutputs('*')).filter(([id]) =>
      id.includes('DomainNameAlias'),
    ),
  );

// Synthesizing a stack takes well under a second in isolation but can pass
// Vitest's 5s default when CI runs every project's tests in parallel.
describe('RestApi', { timeout: 30_000 }, () => {
  it("outputs the custom domain's API Gateway alias target when configured", () => {
    const { stack } = buildApi('api.example.com');
    const [domainNameId] = Object.keys(
      Template.fromStack(stack).findResources('AWS::ApiGateway::DomainName'),
    );

    expect(Object.values(aliasOutputs(stack))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Value: { 'Fn::GetAtt': [domainNameId, 'RegionalDomainName'] },
        }),
        expect.objectContaining({
          Value: { 'Fn::GetAtt': [domainNameId, 'RegionalHostedZoneId'] },
        }),
      ]),
    );
  });

  it('requires TLS 1.3 on the edge-optimized execute-api endpoint', () => {
    const { stack } = buildApi();

    Template.fromStack(stack).hasResourceProperties(
      'AWS::ApiGateway::RestApi',
      {
        SecurityPolicy: 'SecurityPolicy_TLS13_2025_EDGE',
        EndpointAccessMode: 'STRICT',
      },
    );
  });

  it('requires TLS 1.3 on the custom domain when configured', () => {
    const { stack } = buildApi('api.example.com');

    Template.fromStack(stack).hasResourceProperties(
      'AWS::ApiGateway::DomainName',
      {
        SecurityPolicy: 'SecurityPolicy_TLS13_1_3_2025_09',
        EndpointAccessMode: 'STRICT',
      },
    );
  });

  it('disables the execute-api endpoint when a custom domain is configured', () => {
    const { stack } = buildApi('api.example.com');

    Template.fromStack(stack).hasResourceProperties(
      'AWS::ApiGateway::RestApi',
      {
        DisableExecuteApiEndpoint: true,
      },
    );
  });

  it('keeps the execute-api endpoint when no custom domain is configured', () => {
    const { stack } = buildApi();

    Template.fromStack(stack).hasResourceProperties(
      'AWS::ApiGateway::RestApi',
      {
        DisableExecuteApiEndpoint: false,
      },
    );
  });

  it('outputs no alias target when no custom domain is configured', () => {
    const { stack } = buildApi();

    expect(aliasOutputs(stack)).toEqual({});
  });

  it('publishes the custom domain URL in runtime config when configured', () => {
    const { stack } = buildApi('api.example.com');

    expect(RuntimeConfig.of(stack)?.get('connection').apis).toEqual({
      TestApi: 'https://api.example.com/',
    });
  });

  it('falls back to the generated execute-api URL when no custom domain is configured', () => {
    const { stack, api } = buildApi();

    const publishedUrl = stack.resolve(
      RuntimeConfig.of(stack)?.get('connection').apis.TestApi,
    );

    expect(publishedUrl).toEqual(stack.resolve(api.api.url));
  });

  it('includes the base path mapping in the custom domain URL when configured', () => {
    const stack = new Stack(new App(), 'Stack', {
      env: { account: 'test-account', region: 'ap-southeast-2' },
    });
    new RestApi<Operations, ReturnType<typeof buildIntegrations>>(
      stack,
      'Api',
      {
        apiName: 'TestApi',
        operations: { ping: { path: '/ping', method: 'GET' } },
        integrations: buildIntegrations(),
        enableWaf: false,
        domainName: {
          domainName: 'api.example.com',
          basePath: 'v1',
          certificate: Certificate.fromCertificateArn(
            stack,
            'Cert',
            'arn:aws:acm:ap-southeast-2:123456789012:certificate/abc',
          ),
        },
      },
    );

    expect(RuntimeConfig.of(stack)?.get('connection').apis).toEqual({
      TestApi: 'https://api.example.com/v1/',
    });
  });
});
