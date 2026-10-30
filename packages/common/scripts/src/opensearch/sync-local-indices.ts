/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { syncIndices } from '@discava/search';
import { Client } from '@opensearch-project/opensearch';
import { readFileSync } from 'fs';

// The generated manifest: the search project's `indices` target writes it to
// <workspaceRoot>/dist/packages/databases/search/indices/indices.json before
// this runs (the dev and sync-indices targets depend on it). This script runs
// with the search project root as its cwd (Nx sets it), so the manifest is
// three levels up, under dist. Read as plain JSON, so this script is
// independent of the search package's index TS files.
const manifestPath =
  process.env.SEARCH_INDICES_MANIFEST ??
  '../../../dist/packages/databases/search/indices/indices.json';

const localDev = JSON.parse(readFileSync('config.json', 'utf-8')).localDev;

// The container is started in parallel with this script; wait for it, as
// create-local-table.ts retries against the DynamoDB container's port.
const client = new Client({
  // IPv4 explicitly, as common-server-utils' LOCAL_HOST explains.
  node: `http://127.0.0.1:${localDev.port}`,
});

const waitForOpenSearch = async () => {
  for (;;) {
    try {
      if (await client.ping()) return;
    } catch {
      // Not up yet: the container may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};

// The local index name: the search client prefixes `discava-` in local dev
// (resolveIndexName), so the container's indices carry the prefix the deployed
// names don't (the collection holds only this app's indices).
const localIndexName = (name: string) => `discava-${name}`;

const run = async () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
    name: string;
    settings: Record<string, unknown>;
    mappings: Record<string, unknown>;
  }[];
  await waitForOpenSearch();
  const { indexNames } = await syncIndices({
    client,
    indices: manifest,
    indexNames: manifest.map(({ name }) => localIndexName(name)),
  });
  console.log(`Synced local indices: ${indexNames.join(', ')}`);
};

await run();
