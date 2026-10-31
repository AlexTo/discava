/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
} from 'aws-lambda';
import { getOpenSearchClient } from '../client.js';
import type { IndicesManifest } from './sync-indices.js';
import { syncIndices } from './sync-indices.js';

// A fixed id, not one derived from the manifest: CloudFormation replaces a
// custom resource whose PhysicalResourceId changes between calls, which
// would make it try to "delete" the old one (a no-op here, since this never
// deletes indices, but there's no reason to make CloudFormation think a
// replacement happened). OpenSearchCollection in common-constructs sends an
// Update on every deploy (its SyncedAt property differs each time), and
// ManifestHash, set from the same manifest, is echoed back to show which
// one was applied.
const PHYSICAL_RESOURCE_ID = 'search-index-sync';

// A data access policy takes up to about a minute to take effect after it's
// created, and the custom resource runs right after the one granting this
// handler's role access, so its first calls can be answered 403. Retrying a
// forbidden request for a bounded time, rather than failing the deploy (and
// rolling the whole stack back), covers that; anything else fails at once.
const FORBIDDEN_RETRIES = 12;
const FORBIDDEN_RETRY_DELAY_MS = 10_000;

const isForbidden = (error: unknown) => {
  const e = error as { statusCode?: number; meta?: { statusCode?: number } };
  return (e?.statusCode ?? e?.meta?.statusCode) === 403;
};

const syncWhenAllowed = async (manifest: IndicesManifest) => {
  for (let attempt = 1; ; attempt++) {
    try {
      await syncIndices(await getOpenSearchClient(), manifest);
      return;
    } catch (error) {
      if (!isForbidden(error) || attempt > FORBIDDEN_RETRIES) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, FORBIDDEN_RETRY_DELAY_MS),
      );
    }
  }
};

// Backs the index-sync custom resource (OpenSearchCollection, wrapped in a
// `Provider`): creates any index that's missing and updates the mappings of
// those that exist, on every deploy, so an index deleted by hand comes back.
// Idempotent, so running it each time is safe. Runs on Create and Update; Delete is a no-op,
// so destroying the stack leaves the collection's indices (and their data)
// as they were -- matches core-table's RemovalPolicy.RETAIN default.
export const handler = async (
  event: CloudFormationCustomResourceEvent,
): Promise<
  Pick<CloudFormationCustomResourceResponse, 'PhysicalResourceId' | 'Data'>
> => {
  const manifest: IndicesManifest = JSON.parse(
    event.ResourceProperties.Manifest,
  );

  if (event.RequestType !== 'Delete') {
    await syncWhenAllowed(manifest);
  }

  return {
    PhysicalResourceId: PHYSICAL_RESOURCE_ID,
    Data: { Hash: manifest.hash },
  };
};
