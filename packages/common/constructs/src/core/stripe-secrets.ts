/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Names, RemovalPolicy } from 'aws-cdk-lib';
import type { IGrantable } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { ISecret, Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { suppressRules } from './checkov.js';

/**
 * The two Stripe secrets an administrator's save fills in (research R-6, R-14):
 * the secret key and the webhook signing secret. The deployment creates them
 * but no operator sets a value, and CDK's generated placeholder is never
 * trusted: the readers check what they read looks like a key. Only the admin
 * function behind `grantWrite` may change either; checkout reads the key, the
 * webhook reads both.
 */
export abstract class StripeSecretGrants extends Construct {
  public abstract readonly apiKey: ISecret;
  public abstract readonly webhookSigningSecret: ISecret;

  /** Checkout: reads the saved secret key. */
  public grantReadApiKey(grantee: IGrantable) {
    this.apiKey.grantRead(grantee);
  }

  /** The webhook: reads the saved signing secret. */
  public grantReadWebhookSecret(grantee: IGrantable) {
    this.webhookSigningSecret.grantRead(grantee);
  }

  /**
   * The admin function that connects and disconnects Stripe, and nothing
   * else: writes both secrets and reads the key (to remove the old
   * registration when switching).
   */
  public grantWrite(grantee: IGrantable) {
    this.apiKey.grantWrite(grantee);
    this.webhookSigningSecret.grantWrite(grantee);
    this.apiKey.grantRead(grantee);
  }
}

export interface StripeSecretsProps {
  /** Encrypt both with a customer-managed KMS key. @default true */
  readonly enableKmsEncryption?: boolean;
  /** Rotate that key every year. @default true */
  readonly enableKeyRotation?: boolean;
  /** @default RemovalPolicy.RETAIN */
  readonly removalPolicy?: RemovalPolicy;
}

export class StripeSecrets extends StripeSecretGrants {
  public readonly apiKey: Secret;
  public readonly webhookSigningSecret: Secret;

  constructor(scope: Construct, id: string, props: StripeSecretsProps = {}) {
    super(scope, id);
    const kmsEnabled = props.enableKmsEncryption ?? true;
    const removalPolicy = props.removalPolicy ?? RemovalPolicy.RETAIN;
    const encryptionKey = kmsEnabled
      ? new Key(this, 'Key', {
          enableKeyRotation: props.enableKeyRotation ?? true,
          removalPolicy,
        })
      : undefined;

    // Named under the stage's prefix (`discavadevelopment...`): CI's
    // CloudFormation execution role may only manage secrets named that way.
    const create = (name: string, description: string) => {
      const secret = new Secret(this, name, {
        secretName: `${Names.uniqueResourceName(this, { maxLength: 100, separator: '/' })}/${name}`,
        description,
        encryptionKey,
        removalPolicy,
      });
      const suppressed = ['CKV_AWS_304', 'CKV2_AWS_57'];
      if (!kmsEnabled) suppressed.push('CKV_AWS_149');
      suppressRules(
        secret,
        suppressed,
        'Filled by an administrator, not an operator, and replaced by their next save; there is nothing to rotate on a schedule' +
          (kmsEnabled ? '' : '; KMS CMK encryption disabled for this stage'),
      );
      return secret;
    };
    this.apiKey = create(
      'ApiKey',
      'The Stripe secret key an administrator connected (empty until they save one)',
    );
    this.webhookSigningSecret = create(
      'WebhookSigningSecret',
      'The signing secret of the Stripe webhook endpoint (empty until an administrator connects Stripe)',
    );
  }
}

/**
 * The two secrets as another stack sees them. Granting on the secrets
 * themselves would add statements to their KMS key's policy, which lives in
 * the stack that created them, naming a role in the granting stack: a cycle,
 * since that stack already depends on the first. An imported secret and key
 * grant on the reader's role only, which the key's default policy accepts.
 */
export class ImportedStripeSecrets extends StripeSecretGrants {
  public readonly apiKey: ISecret;
  public readonly webhookSigningSecret: ISecret;

  constructor(scope: Construct, id: string, secrets: StripeSecretGrants) {
    super(scope, id);
    const importSecret = (name: string, secret: ISecret) =>
      Secret.fromSecretAttributes(this, name, {
        secretCompleteArn: secret.secretArn,
        encryptionKey: secret.encryptionKey
          ? Key.fromKeyArn(this, `${name}Key`, secret.encryptionKey.keyArn)
          : undefined,
      });
    this.apiKey = importSecret('ApiKey', secrets.apiKey);
    this.webhookSigningSecret = importSecret(
      'WebhookSigningSecret',
      secrets.webhookSigningSecret,
    );
  }
}
