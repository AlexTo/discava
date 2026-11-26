/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { INDICES } from './indices/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// config.json is only present in local dev (not included in the deployed
// bundle); guard with LOCAL_DEV check, as core-table's client does.
const localDev = () =>
  JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf-8')).localDev;

// The deploy-time setting the OpenSearchCollection construct binds to every
// function that uses the collection (common-constructs' `bindSettings`), the
// same way core-table gets its table name. The name is
// `settingEnvName('opensearch', runtimeConfigKey, 'endpoint')`.
const SETTING = 'DISCAVA_OPENSEARCH_SEARCH_ENDPOINT';

export const resolveEndpoint = async (): Promise<string> => {
  if (process.env.LOCAL_DEV === 'true') {
    const { port } = localDev();
    // IPv4 explicitly, as common-server-utils' LOCAL_HOST explains.
    return `http://127.0.0.1:${port}`;
  }
  const endpoint = process.env[SETTING];
  if (!endpoint) {
    throw new Error(`Missing deploy-time setting ${SETTING}`);
  }
  return endpoint;
};

let _client: Client | undefined;

// A local OpenSearch container (no request signing, no security plugin) in
// local dev; the deployed OpenSearch Serverless collection, SigV4-signed with
// the `aoss` service name, otherwise. Serverless has no concept of an
// unsigned request, unlike classic OpenSearch Service.
export const getOpenSearchClient = async (): Promise<Client> => {
  if (!_client) {
    const node = await resolveEndpoint();
    _client =
      process.env.LOCAL_DEV === 'true'
        ? new Client({ node })
        : new Client({
            ...AwsSigv4Signer({
              region: process.env.AWS_REGION ?? 'us-east-1',
              service: 'aoss',
              getCredentials: () => fromNodeProviderChain()(),
            }),
            node,
          });
  }
  return _client;
};

/** The logical names of the indices defined under src/indices. */
export type IndexName = (typeof INDICES)[number]['name'];

// Looks up an index's physical name from its logical one. A thin indirection
// today (they're the same string), kept so every caller goes through one
// place, matching core-table's resolveTableName -- callers never hardcode an
// index string, and an unknown name fails fast instead of silently querying
// an index that was never created.
export const resolveIndexName = (name: IndexName): string => {
  const index = INDICES.find((candidate) => candidate.name === name);
  if (!index) {
    throw new Error(`Unknown search index: ${name}`);
  }
  return index.name;
};
