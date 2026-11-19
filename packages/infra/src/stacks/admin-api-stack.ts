/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AdminApi,
  type AdminPortal,
  CoreTable,
  ImportedStripeSecrets,
  type StripeSecrets,
  UserIdentity,
} from '@discava/common-constructs';
import type { AdminApiComponentConfig } from '@discava/common-infra-config';
import { localPortalOrigins } from '@discava/common-infra-config/local-portals';
import { Stack, StackProps, Stage } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { privilegedHandler, trpcApiProps } from './trpc-api-props.js';

type AdminApiIntegrations = ReturnType<
  ReturnType<typeof AdminApi.defaultIntegrations>['build']
>;

export interface AdminApiStackProps extends StackProps {
  /** Settings for the admin API construct. @default all enabled */
  readonly adminApi?: AdminApiComponentConfig;
  readonly identity: UserIdentity;
  readonly coreTable: CoreTable;
  /** The Stripe secrets an administrator's save writes. */
  readonly stripeSecrets: StripeSecrets;
  /** The only portal that calls admin-api. */
  readonly adminPortal: AdminPortal;
}

/**
 * The tRPC API only administrators can call. It reads and writes the core
 * table (the category taxonomy, reviews, the Stripe connection's record) and
 * needs nothing else, except the `PaymentsConnect` function: the one function
 * that may write the two Stripe secrets, because it connects and disconnects
 * Stripe with a key sent in its request. No function here, nor the API's
 * stage, logs request or response bodies (API Gateway's data trace is off and
 * its access log format has no body), and WAF logs never hold one.
 */
export class AdminApiStack extends Stack {
  public readonly adminApi: AdminApi<AdminApiIntegrations>;

  constructor(
    scope: Construct,
    id: string,
    {
      adminApi: adminApiConfig,
      identity,
      coreTable,
      stripeSecrets,
      adminPortal,
      ...props
    }: AdminApiStackProps,
  ) {
    super(scope, id, props);

    const {
      limits,
      props: apiProps,
      suppressLogGroupKmsRule,
    } = trpcApiProps(this, 'AdminApi', adminApiConfig);
    const integrations = AdminApi.defaultIntegrations(
      this,
      limits.functionOptions,
    ).build();

    this.adminApi = new AdminApi(this, 'AdminApi', {
      integrations,
      identity,
      ...apiProps,
    });
    suppressLogGroupKmsRule();

    Object.values(integrations).forEach(({ handler }) =>
      coreTable.grantReadWriteData(handler),
    );

    // The secrets are imported, so the grants land on the function's role and
    // not on the Data stack's key policy (a cycle otherwise).
    const secrets = new ImportedStripeSecrets(
      this,
      'StripeSecrets',
      stripeSecrets,
    );
    const payments = privilegedHandler(
      AdminApi,
      'admin-api',
      integrations,
      'payment.connect',
    );
    secrets.grantWrite(payments);
    payments.addEnvironment(
      'STRIPE_API_KEY_SECRET_ARN',
      secrets.apiKey.secretArn,
    );
    payments.addEnvironment(
      'STRIPE_WEBHOOK_SECRET_ARN',
      secrets.webhookSigningSecret.secretArn,
    );
    // The stage's name goes into each webhook endpoint's metadata, so a
    // leftover one of ours is recognised. STRIPE_WEBHOOK_URL (the address the
    // endpoint is registered at) is set where the Payments stack exists; until
    // then a connect says the address isn't available.
    payments.addEnvironment(
      'STRIPE_ENDPOINT_STAGE',
      Stage.of(this)?.stageName ?? 'unknown',
    );

    this.adminApi.restrictCorsTo(adminPortal, ...localPortalOrigins('admin'));
  }
}
