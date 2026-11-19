/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type CoreTable,
  ImportedStripeSecrets,
  type StripeSecrets,
  StripeWebhookApi,
} from '@discava/common-constructs';
import type { PaymentsComponentConfig } from '@discava/common-infra-config';
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { trpcApiProps } from './trpc-api-props.js';

export interface PaymentsStackProps extends StackProps {
  /** Settings for the webhook API. @default fully hardened */
  readonly payments?: PaymentsComponentConfig;
  readonly coreTable: CoreTable;
  /** The Stripe secrets the webhook reads. */
  readonly stripeSecrets: StripeSecrets;
}

/**
 * What Stripe calls: `POST /stripe/webhook`, on an API of its own so that
 * its WAF, throttling and domain are the stage's to set apart from the
 * Cognito-guarded APIs. Its function reads and writes the table and reads the
 * two Stripe secrets; an administrator's save is the only writer of those.
 */
export class PaymentsStack extends Stack {
  public readonly webhookApi: StripeWebhookApi;
  /** The address Stripe is told to post to: the custom domain when it has one. */
  public readonly webhookUrl: string;

  constructor(
    scope: Construct,
    id: string,
    { payments, coreTable, stripeSecrets, ...props }: PaymentsStackProps,
  ) {
    super(scope, id, props);

    const {
      limits,
      props: apiProps,
      suppressLogGroupKmsRule,
    } = trpcApiProps(this, 'StripeWebhookApi', payments);

    // The secrets are imported, so the grants land on the function's role and
    // not on the Data stack's key policy (a cycle otherwise).
    this.webhookApi = new StripeWebhookApi(this, 'StripeWebhookApi', {
      coreTable,
      stripeSecrets: new ImportedStripeSecrets(
        this,
        'StripeSecrets',
        stripeSecrets,
      ),
      functionOptions: limits.functionOptions,
      ...apiProps,
    });
    suppressLogGroupKmsRule();
    this.webhookUrl = this.webhookApi.webhookUrl;
  }
}
