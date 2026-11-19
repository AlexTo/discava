/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type CoreTable,
  EventsPayoutRun,
  ImportedStripeSecrets,
  type StripeSecrets,
} from '@discava/common-constructs';
import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';

export interface PayoutsStackProps extends StackProps {
  readonly coreTable: CoreTable;
  /** The Stripe secrets; the payout run reads the API key. */
  readonly stripeSecrets: StripeSecrets;
  /** The stage's smallest payout, in the currency's minor unit. */
  readonly minimumPayoutMinor: number;
}

/**
 * The daily payout run and nothing else, kept apart so no stack nears
 * CloudFormation's 500-resource limit. It has no stream or queue event
 * source: earnings recording lives in the StreamRouter stack. Depends on Data
 * for the table and the Stripe secrets.
 */
export class PayoutsStack extends Stack {
  public readonly payoutRun: EventsPayoutRun;

  constructor(
    scope: Construct,
    id: string,
    {
      coreTable,
      stripeSecrets,
      minimumPayoutMinor,
      ...props
    }: PayoutsStackProps,
  ) {
    super(scope, id, props);

    this.payoutRun = new EventsPayoutRun(this, 'PayoutRun');
    coreTable.grantReadWriteData(this.payoutRun);

    // The secrets are imported, so the grant lands on the function's role and
    // not on the Data stack's key policy (a cycle otherwise). Only the API
    // key is readable: no write, and no signing secret.
    const secrets = new ImportedStripeSecrets(
      this,
      'StripeSecrets',
      stripeSecrets,
    );
    secrets.grantReadApiKey(this.payoutRun);
    this.payoutRun.addEnvironment(
      'STRIPE_API_KEY_SECRET_ARN',
      secrets.apiKey.secretArn,
    );
    this.payoutRun.addEnvironment(
      'PAYOUT_MINIMUM_MINOR',
      String(minimumPayoutMinor),
    );

    new Rule(this, 'PayoutRunSchedule', {
      schedule: Schedule.rate(Duration.days(1)),
      targets: [new LambdaFunction(this.payoutRun)],
    });
  }
}
