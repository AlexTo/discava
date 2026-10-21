/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getAppConfig } from '@aws-lambda-powertools/parameters/appconfig';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Generated: must match runtimeConfigKey in config.json
const runtimeConfigKey = 'CoreTable';

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
      endpoint: `http://localhost:${port}`,
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

type DynamoDBConfig = {
  tableName: string;
};

let _tableName: string | undefined;

export const resolveTableName = async (): Promise<string> => {
  if (process.env.LOCAL_DEV === 'true') {
    const { tableName } = localDev();
    return tableName;
  }
  if (_tableName === undefined) {
    const appId = process.env.RUNTIME_CONFIG_APP_ID;
    if (!appId) {
      throw new Error('RUNTIME_CONFIG_APP_ID environment variable is not set');
    }
    const config = await getAppConfig<{
      [key: string]: DynamoDBConfig | undefined;
    }>('dynamodb', {
      application: appId,
      environment: 'default',
      transform: 'json',
    });
    const tableName = config?.[runtimeConfigKey]?.tableName;
    if (!tableName) {
      throw new Error('Could not resolve table name from runtime config');
    }
    _tableName = tableName;
  }
  return _tableName!;
};
