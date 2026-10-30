/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getAppConfig } from '@aws-lambda-powertools/parameters/appconfig';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Generated: must match runtimeConfigKey in config.json
const runtimeConfigKey = 'Search';

const __dirname = dirname(fileURLToPath(import.meta.url));
// config.json is only present in local dev (not included in the deployed bundle); guard with LOCAL_DEV check
const localDev = () =>
  JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf-8')).localDev;

type SearchConfig = {
  endpoint: string;
};

let _endpoint: string | undefined;

// The collection's endpoint, from AppConfig (the Search key in the
// `opensearch` namespace the OpenSearch construct publishes) when deployed, or
// the local container's in local dev. Resolved once per process, like
// resolveTableName() resolves the table name.
export const resolveCollectionEndpoint = async (): Promise<string> => {
  if (process.env.LOCAL_DEV === 'true') {
    return `http://127.0.0.1:${localDev().port}`;
  }
  if (_endpoint === undefined) {
    const appId = process.env.RUNTIME_CONFIG_APP_ID;
    if (!appId) {
      throw new Error('RUNTIME_CONFIG_APP_ID environment variable is not set');
    }
    const config = await getAppConfig<{
      [key: string]: SearchConfig | undefined;
    }>('opensearch', {
      application: appId,
      environment: 'default',
      transform: 'json',
    });
    const endpoint = config?.[runtimeConfigKey]?.endpoint;
    if (!endpoint) {
      throw new Error(
        'Could not resolve the OpenSearch endpoint from runtime config',
      );
    }
    _endpoint = endpoint;
  }
  return _endpoint!;
};

let _client: Client | undefined;

// The OpenSearch client: the local container in local dev, the stage's
// OpenSearch Serverless collection (SigV4-signed, `aoss` service) otherwise.
// Built once per process from the resolved endpoint and shared by the
// indexing pipeline, the search procedure and the local sync script.
export const getOpenSearchClient = async (): Promise<Client> => {
  if (!_client) {
    const node = await resolveCollectionEndpoint();
    _client =
      process.env.LOCAL_DEV === 'true'
        ? new Client({ node })
        : new Client({
            ...AwsSigv4Signer({
              region: process.env.AWS_REGION ?? 'us-east-1',
              service: 'aoss',
              getCredentials: fromNodeProviderChain(),
            }),
            node,
          });
  }
  return _client;
};

// The local index name for `name`, prefixed per the local dev config; the
// deployed name is the bare `name` (indices live in a dedicated collection).
export const resolveIndexName = (name: string): string =>
  process.env.LOCAL_DEV === 'true' ? `discava-${name}` : name;
