/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { RemovalPolicy } from 'aws-cdk-lib';
import {
  AuthorizationType,
  LambdaIntegration,
  type ThrottleSettings,
} from 'aws-cdk-lib/aws-apigateway';
import type { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import type { CfnFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import {
  type ApiFunctionOptions,
  apiFunctionProps,
} from '../../core/api/function-options.js';
import { RestApi } from '../../core/api/rest-api.js';
import type { RestApiIntegration } from '../../core/api/utils.js';
import { RuntimeConfig } from '../../core/runtime-config.js';
import type { StripeSecretGrants } from '../../core/stripe-secrets.js';
import type { CoreTable } from '../dynamodb/core-table.js';
import { EventsStripeWebhook } from '../lambda-functions/events-stripe-webhook.js';

type Operations = 'stripe.webhook';

export interface StripeWebhookApiProps {
  /** The table the webhook reads orders from and writes their outcome to. */
  readonly coreTable: CoreTable;
  /** The webhook reads the API key (refunds) and the signing secret. */
  readonly stripeSecrets: StripeSecretGrants;
  /** @default true */
  readonly enableWaf?: boolean;
  /** @default true */
  readonly enableKmsEncryption?: boolean;
  /** @default true */
  readonly enableKeyRotation?: boolean;
  /** @default RemovalPolicy.RETAIN */
  readonly removalPolicy?: RemovalPolicy;
  readonly domainName?: string;
  readonly certificate?: ICertificate;
  /** Requests per second (and burst) API Gateway lets through to the method. */
  readonly throttle?: ThrottleSettings;
  /** @default true */
  readonly enableTracing?: boolean;
  /** The function's timeout, reserved concurrency, log level and tracing. */
  readonly functionOptions?: ApiFunctionOptions;
}

/**
 * The API Stripe posts its messages to: one method, `POST /stripe/webhook`,
 * with no authorizer, since the signature on each message is the only gate
 * (the handler verifies it against the raw body). The stage's WAF and
 * throttling stand in front of it. Its function may read and write the table
 * and read the two Stripe secrets, and nothing else.
 */
export class StripeWebhookApi extends RestApi<
  Operations,
  Record<Operations, RestApiIntegration>
> {
  public readonly handler: EventsStripeWebhook;
  /** Where Stripe is told to send messages: the custom domain when set. */
  public readonly webhookUrl: string;

  constructor(
    scope: Construct,
    id: string,
    {
      coreTable,
      stripeSecrets,
      domainName,
      certificate,
      enableTracing = true,
      functionOptions,
      ...props
    }: StripeWebhookApiProps,
  ) {
    const handler = new EventsStripeWebhook(scope, `${id}Handler`);
    super(scope, id, {
      apiName: 'StripeWebhookApi',
      ...(domainName && certificate
        ? { domainName: { domainName, certificate } }
        : {}),
      defaultMethodOptions: { authorizationType: AuthorizationType.NONE },
      deployOptions: { tracingEnabled: enableTracing },
      operations: {
        'stripe.webhook': { method: 'POST', path: '/stripe/webhook' },
      },
      integrations: {
        'stripe.webhook': {
          integration: new LambdaIntegration(handler, {
            scopePermissionToMethod: false,
          }),
          // The base API suppresses the open-method check for exactly this.
          options: { authorizationType: AuthorizationType.NONE },
        },
      },
      ...props,
    });
    this.handler = handler;

    const options = apiFunctionProps({
      ...functionOptions,
      tracing: enableTracing,
    });
    const cfn = handler.node.defaultChild as CfnFunction;
    if (options.reservedConcurrentExecutions !== undefined) {
      cfn.reservedConcurrentExecutions = options.reservedConcurrentExecutions;
    }
    // The generated wrapper traces by default.
    if (!enableTracing) cfn.tracingConfig = undefined;
    if (options.timeout) cfn.timeout = options.timeout.toSeconds();
    // The generated wrapper leaves Lambda's 128 MB default, on which a cold
    // start (core-table, AppConfig, the Stripe SDK) outruns the 10-second
    // timeout, so every delivery fails and no order is ever settled (#654).
    cfn.memorySize = 512;
    for (const [name, value] of Object.entries(options.environment ?? {})) {
      handler.addEnvironment(name, value);
    }

    coreTable.grantReadWriteData(handler);
    // The core-table client resolves the table name through AppConfig.
    const runtimeConfig = RuntimeConfig.ensure(scope);
    handler.addEnvironment(
      'RUNTIME_CONFIG_APP_ID',
      runtimeConfig.appConfigApplicationId,
    );
    runtimeConfig.grantReadAppConfig(handler);
    stripeSecrets.grantReadApiKey(handler);
    stripeSecrets.grantReadWebhookSecret(handler);
    handler.addEnvironment(
      'STRIPE_API_KEY_SECRET_ARN',
      stripeSecrets.apiKey.secretArn,
    );
    handler.addEnvironment(
      'STRIPE_WEBHOOK_SECRET_ARN',
      stripeSecrets.webhookSigningSecret.secretArn,
    );

    this.webhookUrl =
      domainName && certificate
        ? `https://${domainName}/stripe/webhook`
        : `${this.api.url}stripe/webhook`;
  }
}
