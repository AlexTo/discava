/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { AppRouter, appRouter, PUBLIC_OPERATIONS } from '@discava/core-api';
import { Aspects, Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  LambdaIntegration,
  ResponseTransferMode,
  type ThrottleSettings,
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
  Architecture,
  Code,
  Function,
  FunctionProps,
  Runtime,
  Tracing,
} from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as url from 'url';
import {
  type ApiFunctionOptions,
  apiFunctionProps,
} from '../../core/api/function-options.js';
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

// Operations callable without a Cognito token: the method skips the API's
// Cognito authorizer. core-api declares them next to its router, where a test
// checks the list against how each procedure treats an anonymous caller.
const PUBLIC: ReadonlySet<Operations> = new Set<Operations>(PUBLIC_OPERATIONS);

/**
 * Operations served by a dedicated function instead of the shared router,
 * keyed by function name. The infra stack grants these functions the
 * permissions their procedures need beyond the table, which keeps those
 * permissions off the router that serves every other procedure.
 */
export const CORE_API_DEDICATED_FUNCTIONS = {
  // Core-api's only holder of the CloudFront signing key
  VideoUrl: ['contentItem.videoUrl'],
} as const satisfies Record<string, readonly Operations[]>;

const functionNameFor = (op: Operations | '$router'): string =>
  Object.entries(CORE_API_DEDICATED_FUNCTIONS).find(([, ops]) =>
    (ops as readonly string[]).includes(op),
  )?.[0] ?? 'Router';

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
  /**
   * Requests per second (and burst) API Gateway lets through to each method
   * (it throttles every method separately); above it callers get 429 before
   * any Lambda runs.
   *
   * @default RestApi's default
   */
  throttle?: ThrottleSettings;
  /**
   * Trace requests through the API Gateway stage with AWS X-Ray.
   *
   * @default true
   */
  enableTracing?: boolean;
  /**
   * Requests per second (and burst) API Gateway lets through to each
   * operation callable without signing in (PUBLIC_OPERATIONS), tighter than
   * `throttle` since they're the only ones open to anyone.
   *
   * @default `throttle`
   */
  publicThrottle?: ThrottleSettings;
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
   * Whether `op` is served by a function of its own (see
   * CORE_API_DEDICATED_FUNCTIONS) rather than the shared router function.
   */
  public static hasDedicatedFunction(op: string): boolean {
    return functionNameFor(op as Operations) !== 'Router';
  }

  /**
   * Creates default integrations for all operations. Operations listed in
   * CORE_API_DEDICATED_FUNCTIONS are served by their group's function; every
   * other operation shares a single router function. Each operation still
   * gets its own integration entry, so per-operation method options (e.g. the
   * public operations' auth) and grants keep working.
   *
   * @param scope - The CDK construct scope
   * @param functionOptions - The stage's timeout, reserved concurrency, log
   *   level and tracing for the API's functions
   * @returns An IntegrationBuilder with default lambda integrations
   */
  public static defaultIntegrations = (
    scope: Construct,
    functionOptions?: ApiFunctionOptions,
  ) => {
    const rc = RuntimeConfig.ensure(scope);
    const handlers = new Map<string, Function>();
    return IntegrationBuilder.rest({
      pattern: 'isolated',
      operations: routerToOperations(appRouter),
      defaultIntegrationOptions: {
        runtime: Runtime.NODEJS_24_X,
        architecture: Architecture.ARM_64,
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
        ...apiFunctionProps(functionOptions),
      } as FunctionProps,
      buildDefaultIntegration: (op, props: FunctionProps) => {
        // Procedures needing only the table share one function: fewer cold
        // starts and resources, at no cost to least privilege. The bundle is
        // the whole tRPC router either way.
        const functionName = functionNameFor(op);
        let handler = handlers.get(functionName);
        if (!handler) {
          handler = new Function(scope, `CoreApi${functionName}Handler`, props);
          handler.addEnvironment(
            'RUNTIME_CONFIG_APP_ID',
            rc.appConfigApplicationId,
          );
          rc.grantReadAppConfig(handler);
          handlers.set(functionName, handler);
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
          options: PUBLIC.has(op)
            ? { authorizationType: AuthorizationType.NONE }
            : undefined,
        };
      },
    });
  };

  constructor(
    scope: Construct,
    id: string,
    {
      domainName,
      certificate,
      enableTracing = true,
      publicThrottle,
      ...props
    }: CoreApiProps<TIntegrations>,
  ) {
    const operations = routerToOperations(appRouter);
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
        tracingEnabled: enableTracing,
        // Stage method settings for the public operations, on top of the
        // default (/*/*) that RestApi sets from `throttle`.
        ...(publicThrottle && {
          methodOptions: Object.fromEntries(
            [...PUBLIC].map((op) => [
              `/${op}/${operations[op].method}`,
              {
                throttlingRateLimit: publicThrottle.rateLimit,
                throttlingBurstLimit: publicThrottle.burstLimit,
              },
            ]),
          ),
        }),
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
      operations,
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
