/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { AppRouter, appRouter } from '@discava/core-api';
import { Aspects, Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  LambdaIntegration,
  ResponseTransferMode,
} from 'aws-cdk-lib/aws-apigateway';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Distribution } from 'aws-cdk-lib/aws-cloudfront';
import { IUserPool } from 'aws-cdk-lib/aws-cognito';
import {
  AnyPrincipal,
  Effect,
  PolicyDocument,
  PolicyStatement,
} from 'aws-cdk-lib/aws-iam';
import {
  Code,
  Function,
  FunctionProps,
  Runtime,
  Tracing,
} from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as url from 'url';
import { AddCorsPreflightAspect, RestApi } from '../../core/api/rest-api.js';
import { Procedures, routerToOperations } from '../../core/api/trpc-utils.js';
import {
  ApiIntegrations,
  IntegrationBuilder,
  RestApiIntegration,
} from '../../core/api/utils.js';
import { findCloudFrontDomainNames } from '../../core/cloudfront.js';
import { RuntimeConfig } from '../../core/runtime-config.js';

// String union type for all API operation names
type Operations = Procedures<AppRouter>;

// Operations built on publicProcedure/publicCourseProcedure (see
// packages/apis/core-api/src/init.ts) rather than protectedProcedure -
// callable without a Cognito token. Listed explicitly so a new public
// procedure doesn't silently inherit Cognito auth at the API Gateway layer
// just because this list wasn't updated alongside it.
const PUBLIC_OPERATIONS: ReadonlySet<Operations> = new Set([
  'course.publicList',
]);

/**
 * Properties for creating a CoreApi construct
 *
 * @template TIntegrations - Map of operation names to their integrations
 */
export interface CoreApiProps<
  TIntegrations extends ApiIntegrations<Operations, RestApiIntegration>,
> {
  /**
   * Map of operation names to their API Gateway integrations
   */
  integrations: TIntegrations;
  /**
   * Identity details for Cognito Authentication
   */
  identity: {
    userPool: IUserPool;
  };
  /**
   * Whether to enable AWS WAFv2 with the default managed ruleset on the API's default stage.
   *
   * @default true
   */
  enableWaf?: boolean;
  /**
   * Whether to encrypt the API access log group with a customer-managed KMS key.
   * When disabled, CloudWatch Logs still encrypts log data at rest using an
   * AWS-owned key.
   *
   * @default true
   */
  enableKmsEncryption?: boolean;
  /**
   * Whether to enable automatic key rotation on the KMS key used to encrypt
   * the access log group. Only used when `enableKmsEncryption` is `true`.
   *
   * @default true
   */
  enableKeyRotation?: boolean;
  /**
   * What happens to the access log group (and its KMS key, if any) when it's
   * removed from the stack or the stack is deleted.
   *
   * @default RemovalPolicy.RETAIN
   */
  removalPolicy?: RemovalPolicy;
  /**
   * Custom domain name for the API Gateway REST API. Requires `certificate`.
   */
  domainName?: string;
  /**
   * ACM certificate for the custom domain name. Must be in the same region as the API.
   */
  certificate?: ICertificate;
}

/**
 * A CDK construct that creates and configures an AWS API Gateway REST API
 * specifically for CoreApi.
 * @template TIntegrations - Map of operation names to their integrations
 */
export class CoreApi<
  TIntegrations extends ApiIntegrations<Operations, RestApiIntegration>,
> extends RestApi<Operations, TIntegrations> {
  private allowedOrigins: readonly string[] = ['*'];

  /**
   * Creates default integrations for all operations, all served by a single
   * shared lambda function. Each operation still gets its own integration
   * entry, so per-operation method options (e.g. the public operations' auth)
   * keep working.
   *
   * @param scope - The CDK construct scope
   * @returns An IntegrationBuilder with default lambda integrations
   */
  public static defaultIntegrations = (scope: Construct) => {
    const rc = RuntimeConfig.ensure(scope);
    let handler: Function | undefined;
    return IntegrationBuilder.rest({
      pattern: 'isolated',
      operations: routerToOperations(appRouter),
      defaultIntegrationOptions: {
        runtime: Runtime.NODEJS_24_X,
        handler: 'index.handler',
        code: Code.fromAsset(
          url.fileURLToPath(
            new URL(
              '../../../../../../dist/packages/apis/core-api/bundle',
              import.meta.url,
            ),
          ),
        ),
        memorySize: 256,
        timeout: Duration.seconds(30),
        tracing: Tracing.ACTIVE,
      } as FunctionProps,
      buildDefaultIntegration: (op, props: FunctionProps) => {
        // Every core-api procedure needs the same permissions, so they share
        // one function: fewer cold starts and resources, at no cost to least
        // privilege. The bundle is the whole tRPC router either way.
        if (!handler) {
          handler = new Function(scope, 'CoreApiRouterHandler', props);
          handler.addEnvironment(
            'RUNTIME_CONFIG_APP_ID',
            rc.appConfigApplicationId,
          );
          rc.grantReadAppConfig(handler);
        }
        return {
          handler,
          integration: new LambdaIntegration(handler, {
            responseTransferMode: ResponseTransferMode.STREAM,
            // As in @aws/nx-plugin's shared pattern: one Lambda::Permission
            // per function for the whole API, instead of one per method
            // (each method would otherwise add its own). allowTestInvoke is
            // ignored in this mode, so it isn't set.
            scopePermissionToMethod: false,
          }),
          options: PUBLIC_OPERATIONS.has(op)
            ? { authorizationType: AuthorizationType.NONE }
            : undefined,
        };
      },
    });
  };

  constructor(
    scope: Construct,
    id: string,
    { domainName, certificate, ...props }: CoreApiProps<TIntegrations>,
  ) {
    super(scope, id, {
      apiName: 'CoreApi',
      ...(domainName && certificate
        ? { domainName: { domainName, certificate } }
        : {}),
      defaultMethodOptions: {
        authorizationType: AuthorizationType.COGNITO,
        authorizer: new CognitoUserPoolsAuthorizer(scope, 'CoreApiAuthorizer', {
          cognitoUserPools: [props.identity.userPool],
        }),
        // Accept access tokens from both sign-in flows: 'openid' (Cognito hosted UI)
        // and 'aws.cognito.signin.user.admin' (Cognito admin/SRP auth APIs).
        authorizationScopes: ['openid', 'aws.cognito.signin.user.admin'],
      },
      deployOptions: {
        tracingEnabled: true,
      },
      policy: new PolicyDocument({
        statements: [
          // Allow all callers to invoke the API in the resource policy, since auth is handled by Cognito
          new PolicyStatement({
            effect: Effect.ALLOW,
            principals: [new AnyPrincipal()],
            actions: ['execute-api:Invoke'],
            resources: ['execute-api:/*'],
          }),
        ],
      }),
      operations: routerToOperations(appRouter),
      ...props,
    });
    Aspects.of(this).add(new AddCorsPreflightAspect(() => this.allowedOrigins));
  }

  /**
   * Restricts CORS to the provided origins
   *
   * Configures the provided CloudFront distribution domains or origin strings
   * as the only permitted CORS origins in API Gateway preflight responses and the
   * AWS Lambda integrations. Any custom domain names (aliases) configured on a
   * CloudFront distribution are included automatically alongside its default
   * `*.cloudfront.net` domain.
   *
   * @param origins - The origin strings, CloudFront distributions, or objects containing a CloudFront distribution to grant CORS from
   */
  public restrictCorsTo(
    ...origins: (
      | string
      | Distribution
      | { cloudFrontDistribution: Distribution }
    )[]
  ) {
    const allowedOrigins = origins.flatMap((origin) =>
      typeof origin === 'string'
        ? [origin]
        : findCloudFrontDomainNames(
            'cloudFrontDistribution' in origin
              ? origin.cloudFrontDistribution
              : origin,
          ).map((domain) => `https://${domain}`),
    );

    this.allowedOrigins = allowedOrigins;

    // Set ALLOWED_ORIGINS environment variable for all Lambda integrations
    Object.values(this.integrations).forEach((integration) => {
      if ('handler' in integration && integration.handler instanceof Function) {
        integration.handler.addEnvironment(
          'ALLOWED_ORIGINS',
          allowedOrigins.join(','),
        );
      }
    });
  }
}
