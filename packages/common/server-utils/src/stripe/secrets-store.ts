/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { isLocalDev } from '../local-dev.js';

// Where the two Stripe secrets live: Secrets Manager when deployed, a pair of
// git-ignored files under `tmp/local-dev/secrets/` in local dev, behind the
// same functions (research R-6, R-18). This is the shared plumbing. What the
// checkout and webhook code may import is `secrets.ts` (read only); the
// functions that write are in `secrets-admin.ts`, for the admin function.
// Nothing here logs or throws a value.

export type StripeSecretName = 'api-key' | 'webhook-secret';

const ENVIRONMENT_VARIABLE: Record<StripeSecretName, string> = {
  'api-key': 'STRIPE_API_KEY_SECRET_ARN',
  'webhook-secret': 'STRIPE_WEBHOOK_SECRET_ARN',
};
const LOCAL_FILE: Record<StripeSecretName, string> = {
  'api-key': 'stripe-api-key',
  'webhook-secret': 'stripe-webhook-secret',
};

/** What an overwritten secret holds: payments are not connected. */
export const STRIPE_SECRET_PLACEHOLDER = 'not-connected';

export class PaymentsNotConnectedError extends Error {
  constructor(message = 'Payments are not connected') {
    super(message);
    this.name = 'PaymentsNotConnectedError';
  }
}

// Tests point the store at a temporary directory; it is only honoured in local
// dev, so a deployed Lambda can't be redirected by its environment.
export const localSecretsDir = (): string =>
  (isLocalDev() && process.env.LOCAL_SECRETS_DIR) ||
  fileURLToPath(
    new URL('../../../../../tmp/local-dev/secrets/', import.meta.url),
  );

const localPath = (name: StripeSecretName) =>
  path.join(localSecretsDir(), LOCAL_FILE[name]);

let client: SecretsManagerClient | undefined;
const secretsManager = () => {
  client ??= new SecretsManagerClient({});
  return client;
};

const secretId = (name: StripeSecretName): string => {
  const variable = ENVIRONMENT_VARIABLE[name];
  const id = process.env[variable];
  if (!id) throw new PaymentsNotConnectedError(`${variable} is not set`);
  return id;
};

/** Reads a secret's stored text; `undefined` when nothing was ever written. */
export const readSecret = async (
  name: StripeSecretName,
): Promise<string | undefined> => {
  if (isLocalDev()) {
    try {
      return (await readFile(localPath(name), 'utf8')).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new PaymentsNotConnectedError(
          `Payments are not connected: ${localPath(name)} does not exist`,
        );
      }
      throw error;
    }
  }
  const { SecretString } = await secretsManager().send(
    new GetSecretValueCommand({ SecretId: secretId(name) }),
  );
  return SecretString;
};

export const writeSecret = async (
  name: StripeSecretName,
  value: string,
): Promise<void> => {
  if (isLocalDev()) {
    await mkdir(localSecretsDir(), { recursive: true, mode: 0o700 });
    await writeFile(localPath(name), value, { mode: 0o600 });
    return;
  }
  await secretsManager().send(
    new PutSecretValueCommand({
      SecretId: secretId(name),
      SecretString: value,
    }),
  );
};

/** Local dev only: removes the secrets directory (reset-local-data does too). */
export const removeLocalSecrets = async (): Promise<void> => {
  await rm(localSecretsDir(), { recursive: true, force: true });
};
