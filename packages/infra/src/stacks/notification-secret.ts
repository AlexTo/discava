/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Key } from 'aws-cdk-lib/aws-kms';
import { ISecret, Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

/**
 * The unsubscribe secret as another stack sees it. Granting on the secret
 * itself would add a statement to its KMS key's policy, which lives in Data,
 * naming a role in the granting stack: a cycle, since that stack already
 * depends on Data. An imported secret and key grant on the reader's role
 * only, which the key's default policy accepts.
 */
export const importNotificationUnsubscribeSecret = (
  scope: Construct,
  secret: ISecret,
): ISecret =>
  Secret.fromSecretAttributes(scope, 'NotificationUnsubscribeSecret', {
    secretCompleteArn: secret.secretArn,
    encryptionKey: secret.encryptionKey
      ? Key.fromKeyArn(
          scope,
          'NotificationUnsubscribeSecretKey',
          secret.encryptionKey.keyArn,
        )
      : undefined,
  });
