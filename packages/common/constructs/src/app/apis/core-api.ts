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
import { suppressRules } from '../../core/checkov.js';
import { findCloudFrontDomainNames } from '../../core/cloudfront.js';

type Operations = Procedures<AppRouter>;

// Operations callable without a Cognito token: the method skips the API's
// Cognito authorizer. core-api declares them next to its router, where a test
// checks the list against how each procedure treats an anonymous caller.
const PUBLIC: ReadonlySet<Operations> = new Set<Operations>(PUBLIC_OPERATIONS);
// Has a throttle of its own, `publicSuggestThrottle`.
const SUGGEST_OPERATION = 'course.publicSuggest' satisfies Operations;

/**
 * Operations served by a dedicated function instead of the shared router,
 * keyed by function name. The infra stack grants these functions the
 * permissions their procedures need beyond the table, which keeps those
 * permissions off the router that serves every other procedure.
 */
export const CORE_API_DEDICATED_FUNCTIONS = {
  // Core-api's only holder of the CloudFront signing key: video playback and
  // file download links, for enrolled students and for free preview lessons
  MediaUrl: [
    'contentItem.videoUrl',
    'course.previewVideoUrl',
    'contentItem.fileUrl',
    'assignment.submissionFileUrl',
    'freePreview.videoUrl',
    'freePreview.fileUrl',
  ],
  // A student's submission to an upload assignment (#102): holds S3 and
  // Scheduler rights, to hand out upload links and copy the file into the
  // lesson media bucket
  AssignmentSubmit: ['assignment.uploadUrl', 'assignment.submit'],
  // Starts a paid checkout and asks for a student's refund: the only core-api
  // function that reads the Stripe API key
  PaymentsCheckout: ['payment.checkout', 'payment.requestRefund'],
} as const satisfies Record<string, readonly Operations[]>;

/**
 * Dedicated functions with a timeout of their own, set after the stage's
 * options so a stage's `timeoutSeconds` can't raise it. AssignmentSubmit
 * copies a file of up to 100 MB inside the request: it stays below API
 * Gateway's 29 s, so a request never commits after the gateway has already
 * answered for it.
 */
const DEDICATED_FUNCTION_TIMEOUTS: Readonly<Record<string, Duration>> = {
  AssignmentSubmit: Duration.seconds(25),
};

const functionNameFor = (op: Operations | '$router'): string =>
  Object.entries(CORE_API_DEDICATED_FUNCTIONS).find(([, ops]) =>
    (ops as readonly string[]).includes(op),
  )?.[0] ?? 'Router';

/**
 * A route beside the tRPC router's operations, such as a link opened from an
 * email that no tRPC client calls.
 */
export interface CoreApiExtraRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** The path below the API's root, without a leading slash, e.g. `unsubscribe/{token}`. */
  path: string;
  integration: RestApiIntegration;
  /**
   * Whether anyone may call it: it skips the Cognito authorizer and gets the
   * API's `publicThrottle`. Otherwise it needs a signed-in user like the
   * router's operations.
   */
  public: boolean;
}

export interface CoreApiProps<
  TIntegrations extends ApiIntegrations<Operations, RestApiIntegration>,
> {
  integrations: TIntegrations;
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
  /**
   * Requests per second (and burst) API Gateway lets through to
   * `course.publicSuggest`, the search box's suggestions, which fire on every
   * typing pause. Every other public operation keeps `publicThrottle`.
   *
   * @default `publicThrottle`
   */
  publicSuggestThrottle?: ThrottleSettings;
  /**
   * Routes beside the router's operations. CORS is restricted like the rest
   * of the API's.
   *
   * @default none
   */
  extraRoutes?: readonly CoreApiExtraRoute[];
}

/**
 * A CDK construct that creates and configures an AWS API Gateway REST API
 * specifically for CoreApi.
 */
export class CoreApi<
  TIntegrations extends ApiIntegrations<Operations, RestApiIntegration>,
> extends RestApi<Operations, TIntegrations> {
  private allowedOrigins: readonly string[] = ['*'];
  private readonly extraRoutes: readonly CoreApiExtraRoute[];

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
   * @param functionOptions - The stage's timeout, reserved concurrency, log
   *   level and tracing for the API's functions
   */
  public static defaultIntegrations = (
    scope: Construct,
    functionOptions?: ApiFunctionOptions,
  ) => {
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
          const timeout = DEDICATED_FUNCTION_TIMEOUTS[functionName];
          handler = new Function(
            scope,
            `CoreApi${functionName}Handler`,
            timeout ? { ...props, timeout } : props,
          );
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
      publicSuggestThrottle,
      extraRoutes = [],
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
            [
              ...[...PUBLIC].map((op) => `/${op}/${operations[op].method}`),
              ...extraRoutes
                .filter((route) => route.public)
                .map((route) => `/${route.path}/${route.method}`),
            ].map((key) => {
              const throttle =
                key ===
                `/${SUGGEST_OPERATION}/${operations[SUGGEST_OPERATION].method}`
                  ? (publicSuggestThrottle ?? publicThrottle)
                  : publicThrottle;
              return [
                key,
                {
                  throttlingRateLimit: throttle.rateLimit,
                  throttlingBurstLimit: throttle.burstLimit,
                },
              ];
            }),
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
    this.extraRoutes = extraRoutes;
    for (const route of extraRoutes) this.addExtraRoute(route);
    Aspects.of(this).add(new AddCorsPreflightAspect(() => this.allowedOrigins));
  }

  private addExtraRoute({
    method,
    path,
    integration,
    public: isPublic,
  }: CoreApiExtraRoute) {
    const added = this.api.root
      .resourceForPath(path)
      .addMethod(method, integration.integration, {
        ...integration.options,
        ...(isPublic && { authorizationType: AuthorizationType.NONE }),
      });
    if (isPublic) {
      suppressRules(
        added,
        ['CKV_AWS_59'],
        'Intentionally public route - see the extra route declared with public: true',
      );
    }
  }

  /**
   * Configures the provided CloudFront distribution domains or origin strings
   * as the only permitted CORS origins in API Gateway preflight responses and the
   * AWS Lambda integrations. Any custom domain names (aliases) configured on a
   * CloudFront distribution are included automatically alongside its default
   * `*.cloudfront.net` domain.
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

    [
      ...Object.values(this.integrations),
      ...this.extraRoutes.map((route) => route.integration),
    ].forEach((integration) => {
      if ('handler' in integration && integration.handler instanceof Function) {
        integration.handler.addEnvironment(
          'ALLOWED_ORIGINS',
          allowedOrigins.join(','),
        );
      }
    });
  }
}
