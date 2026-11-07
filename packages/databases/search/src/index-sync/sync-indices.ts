/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import type { Client } from '@opensearch-project/opensearch';

export interface IndexManifestEntry {
  readonly name: string;
  readonly settings?: Record<string, unknown>;
  readonly mappings: Record<string, unknown>;
}

export interface IndicesManifest {
  readonly indices: readonly IndexManifestEntry[];
  readonly hash: string;
}

export const loadManifest = (path: string): IndicesManifest =>
  JSON.parse(readFileSync(path, 'utf-8'));

/**
 * Creates every index in the manifest that doesn't exist yet, and updates
 * the mapping of one that does. Never deletes an index: removing a document
 * type from the manifest just stops it being kept in sync here, so no data
 * is lost by a manifest edit alone. Shared by local dev
 * (sync-local-indices.ts) and the deployed custom resource (handler.ts), so
 * both ways of running it stay identical.
 */
export const syncIndices = async (
  client: Client,
  manifest: IndicesManifest,
): Promise<void> => {
  for (const { name, settings, mappings } of manifest.indices) {
    const { body: exists } = await client.indices.exists({ index: name });
    if (!exists) {
      await client.indices.create({
        index: name,
        body: { settings, mappings },
      });
    } else {
      await client.indices.putMapping({ index: name, body: mappings });
    }
  }
};
