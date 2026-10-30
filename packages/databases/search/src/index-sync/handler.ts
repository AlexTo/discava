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
// replacement happened). The ManifestHash resource property is what makes
// CloudFormation send this an Update at all when the manifest changes;
// OpenSearchCollection in common-constructs sets it from the same manifest.
const PHYSICAL_RESOURCE_ID = 'search-index-sync';

// Backs the index-sync custom resource (OpenSearchCollection, wrapped in a
// `Provider`): creates indices and updates their mappings on every deploy
// where the manifest changed. Runs on Create and Update; Delete is a no-op,
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
    const client = await getOpenSearchClient();
    await syncIndices(client, manifest);
  }

  return {
    PhysicalResourceId: PHYSICAL_RESOURCE_ID,
    Data: { Hash: manifest.hash },
  };
};
