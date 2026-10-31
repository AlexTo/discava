/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export {
  getOpenSearchClient,
  type IndexName,
  resolveEndpoint,
  resolveIndexName,
} from './client.js';
export { backfill } from './index-sync/backfill.js';
export {
  type IndexManifestEntry,
  type IndicesManifest,
  loadManifest,
  syncIndices,
} from './index-sync/sync-indices.js';
export * from './indices/index.js';
