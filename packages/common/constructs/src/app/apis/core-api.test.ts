/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
// (CDK resolves asset paths from import.meta.url, which jsdom doesn't provide.)
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AuthorizationType, MockIntegration } from 'aws-cdk-lib/aws-apigateway';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { describe, expect, it } from 'vitest';
import type { RestApiIntegration } from '../../core/api/utils.js';
import { CORE_API_DEDICATED_FUNCTIONS, CoreApi } from './core-api.js';

const mock = (): RestApiIntegration => ({
  integration: new MockIntegration({
    integrationResponses: [{ statusCode: '200' }],
    requestTemplates: { 'application/json': '{"statusCode": 200}' },
  }),
});

type ExtraRoutes = NonNullable<
  ConstructorParameters<typeof CoreApi>[2]['extraRoutes']
>;

const synth = (extraRoutes?: ExtraRoutes, suggestThrottle?: boolean) => {
  const stack = new Stack(new App(), 'Stack', {
    env: { account: '111122223333', region: 'ap-southeast-2' },
  });
  const api = new CoreApi(stack, 'CoreApi', {
    // Every operation shares the router's integration.
    integrations: { $router: mock() } as never,
    identity: { userPool: new UserPool(stack, 'Pool') },
    enableWaf: false,
    publicThrottle: { rateLimit: 2, burstLimit: 4 },
    ...(suggestThrottle && {
      publicSuggestThrottle: { rateLimit: 7, burstLimit: 9 },
    }),
    ...(extraRoutes && { extraRoutes }),
  });
  api.restrictCorsTo('https://portal.example.com');
  return Template.fromStack(stack);
};

const methods = (template: Template, httpMethod: string) =>
  Object.values(template.findResources('AWS::ApiGateway::Method')).filter(
    (method) => method.Properties.HttpMethod === httpMethod,
  );

const unsubscribe = (): ExtraRoutes => [
  {
    method: 'GET',
    path: 'unsubscribe/{token}',
    integration: mock(),
    public: true,
  },
  {
    method: 'POST',
    path: 'unsubscribe/{token}',
    integration: mock(),
    public: true,
  },
];

describe('CoreApi extra routes', () => {
  const without = synth();
  const withRoutes = synth(unsubscribe());

  it('adds none by default', () => {
    expect(
      Object.values(without.findResources('AWS::ApiGateway::Resource')).some(
        (resource) => resource.Properties.PathPart === 'unsubscribe',
      ),
    ).toBe(false);
  });

  it('adds a public GET and POST on unsubscribe/{token}, with no authorizer', () => {
    const resource = Object.entries(
      withRoutes.findResources('AWS::ApiGateway::Resource'),
    ).find(([, r]) => r.Properties.PathPart === '{token}');
    expect(resource).toBeDefined();
    for (const httpMethod of ['GET', 'POST']) {
      const [method] = methods(withRoutes, httpMethod).filter((m) =>
        JSON.stringify(m.Properties.ResourceId).includes(resource![0]),
      );
      expect(method.Properties.AuthorizationType).toBe('NONE');
      expect(method.Properties.AuthorizerId).toBeUndefined();
    }
  });

  it('applies the public throttle to them', () => {
    withRoutes.hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          HttpMethod: 'GET',
          ResourcePath: '/~1unsubscribe~1{token}',
          ThrottlingRateLimit: 2,
          ThrottlingBurstLimit: 4,
        }),
        Match.objectLike({
          HttpMethod: 'POST',
          ResourcePath: '/~1unsubscribe~1{token}',
          ThrottlingRateLimit: 2,
          ThrottlingBurstLimit: 4,
        }),
      ]),
    });
  });

  it('answers CORS preflight for them like every other resource', () => {
    expect(methods(withRoutes, 'OPTIONS').length).toBe(
      methods(without, 'OPTIONS').length + 2,
    );
  });

  it('keeps every existing route as it was, and adds only the two', () => {
    const summary = (template: Template) =>
      methods(template, 'GET')
        .concat(methods(template, 'POST'))
        .map(
          (m) => `${m.Properties.HttpMethod} ${m.Properties.AuthorizationType}`,
        );
    const before = summary(without);
    const after = summary(withRoutes);
    expect(after).toHaveLength(before.length + 2);
    for (const entry of new Set(before)) {
      expect(after.filter((e) => e === entry).length).toBeGreaterThanOrEqual(
        before.filter((e) => e === entry).length,
      );
    }
    expect(
      Object.values(withRoutes.findResources('AWS::ApiGateway::Method')).length,
    ).toBe(
      Object.values(without.findResources('AWS::ApiGateway::Method')).length +
        4,
    );
  });

  it('leaves a non-public extra route behind the Cognito authorizer', () => {
    const template = synth([
      {
        method: 'GET',
        path: 'private/thing',
        integration: mock(),
        public: false,
      },
    ]);
    const resource = Object.entries(
      template.findResources('AWS::ApiGateway::Resource'),
    ).find(([, r]) => r.Properties.PathPart === 'thing')!;
    const [method] = methods(template, 'GET').filter((m) =>
      JSON.stringify(m.Properties.ResourceId).includes(resource[0]),
    );
    expect(method.Properties.AuthorizationType).toBe('COGNITO_USER_POOLS');
  });
});

describe('CoreApi suggest throttle', () => {
  it('gives course.publicSuggest its own throttle and leaves the other public operations on the public one', () => {
    synth(undefined, true).hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          HttpMethod: 'GET',
          ResourcePath: '/~1course.publicSearch',
          ThrottlingRateLimit: 2,
          ThrottlingBurstLimit: 4,
        }),
        Match.objectLike({
          HttpMethod: 'GET',
          ResourcePath: '/~1course.publicSuggest',
          ThrottlingRateLimit: 7,
          ThrottlingBurstLimit: 9,
        }),
      ]),
    });
  });

  it('uses the public throttle for it when no suggest throttle is given', () => {
    synth().hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          HttpMethod: 'GET',
          ResourcePath: '/~1course.publicSuggest',
          ThrottlingRateLimit: 2,
          ThrottlingBurstLimit: 4,
        }),
      ]),
    });
  });
});

describe('CoreApi free preview operations', () => {
  const template = synth();
  const FREE_PREVIEW = [
    'freePreview.lesson',
    'freePreview.videoUrl',
    'freePreview.fileUrl',
  ];

  it('serves the signing ones from MediaUrl, and nothing else new', () => {
    expect([...CORE_API_DEDICATED_FUNCTIONS.MediaUrl].sort()).toEqual(
      [
        'contentItem.videoUrl',
        'course.previewVideoUrl',
        'contentItem.fileUrl',
        'assignment.submissionFileUrl',
        'freePreview.videoUrl',
        'freePreview.fileUrl',
      ].sort(),
    );
  });

  it('serves freePreview.lesson from the shared router', () => {
    const dedicated: string[] = Object.values(
      CORE_API_DEDICATED_FUNCTIONS,
    ).flat();
    expect(dedicated).not.toContain('freePreview.lesson');
  });

  it('integrates the three without the authorizer, and the signing two with the media function', () => {
    const stack = new Stack(new App(), 'DefaultsStack', {
      env: { account: '111122223333', region: 'ap-southeast-2' },
    });
    const integrations = CoreApi.defaultIntegrations(stack).build();
    for (const operation of FREE_PREVIEW) {
      expect(
        integrations[operation as keyof typeof integrations].options
          ?.authorizationType,
      ).toBe(AuthorizationType.NONE);
    }
    expect(integrations['freePreview.videoUrl'].handler).toBe(
      integrations['contentItem.videoUrl'].handler,
    );
    expect(integrations['freePreview.fileUrl'].handler).toBe(
      integrations['contentItem.fileUrl'].handler,
    );
    expect(integrations['freePreview.lesson'].handler).toBe(
      integrations['course.publicView'].handler,
    );
    // Synthesising the Lambda assets is slow on a busy CI runner.
  }, 60_000);

  it.each(FREE_PREVIEW)('%s carries the public throttle', (operation) => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          HttpMethod: 'GET',
          ResourcePath: `/~1${operation}`,
          ThrottlingRateLimit: 2,
          ThrottlingBurstLimit: 4,
        }),
      ]),
    });
  });
});
