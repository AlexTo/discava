/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// config.json is only present in local dev (not included in the deployed bundle); guard with LOCAL_DEV check
const localDev = () =>
  JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf-8')).localDev;

// DynamoDB local in local dev, the Lambda's own defaults otherwise. Shared
// with clients for the same table's other APIs, such as local dev's stream
// reader (#137).
export const dynamoDBClientConfig = () => {
  if (process.env.LOCAL_DEV === 'true') {
    const { port } = localDev();
    return {
      // IPv4 explicitly, as common-server-utils' LOCAL_HOST explains.
      endpoint: `http://127.0.0.1:${port}`,
      region: 'us-east-1',
      credentials: { accessKeyId: 'UNUSED', secretAccessKey: 'UNUSED' },
    };
  }
  return {};
};

let _client: DynamoDBClient | undefined;

export const getDynamoDBClient = (): DynamoDBClient => {
  if (!_client) {
    _client = new DynamoDBClient(dynamoDBClientConfig());
  }
  return _client;
};

// The deploy-time setting the CoreTable construct binds to every function
// that uses the table (common-constructs' `bindSettings`). The name is
// `settingEnvName('dynamodb', runtimeConfigKey)`; common-server-utils depends
// on this package, so it can't be imported here.
const SETTING = 'DISCAVA_DYNAMODB_CORE_TABLE';

export const resolveTableName = async (): Promise<string> => {
  if (process.env.LOCAL_DEV === 'true') {
    const { tableName } = localDev();
    return tableName;
  }
  const raw = process.env[SETTING];
  if (!raw) {
    throw new Error(`Missing deploy-time setting ${SETTING}`);
  }
  let tableName: string | undefined;
  try {
    tableName = (JSON.parse(raw) as { tableName?: string }).tableName;
  } catch {
    throw new Error(`Invalid deploy-time setting ${SETTING}`);
  }
  if (!tableName) {
    throw new Error(`Could not resolve table name from ${SETTING}`);
  }
  return tableName;
};
