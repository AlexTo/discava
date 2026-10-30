/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Client } from '@opensearch-project/opensearch';

// One entry in the generated indices.json manifest: the raw definition for
// one index (name, settings, mappings). The manifest is flattened from the
// index modules' default exports by scripts/generate-indices-manifest.ts; this
// sees only that plain JSON, no TS awareness.
export interface IndexManifestEntry {
  name: string;
  settings: Record<string, unknown>;
  mappings: Record<string, unknown>;
}

// The core create/update logic, shared by local dev's sync script and the
// deploy-time Lambda. Creates an index if it's missing, otherwise updates its
// mapping. It never deletes an index: an index removed from the manifest is
// left in place on purpose, since deleting one destroys data and that stays a
// manual, explicit step.
//
// `indexNames` is the manifest's names, already prefixed for the target
// (resolveIndexName in the local/dev path, bare names when deployed to the
// collection's own namespace), so this stays target-agnostic.
export const syncIndices = async ({
  client,
  indices,
  indexNames,
}: {
  client: Client;
  indices: IndexManifestEntry[];
  indexNames?: string[];
}): Promise<{ indexNames: string[] }> => {
  const names = indexNames ?? indices.map((i) => i.name);
  for (let i = 0; i < indices.length; i++) {
    const { settings, mappings } = indices[i];
    const index = names[i];
    const { body: exists } = await client.indices.exists({ index });
    if (!exists) {
      // settings/mappings are plain JSON from the manifest; the client's
      // request-body types aren't exported, so the cast is the boundary where
      // the untyped manifest meets the typed client.
      await client.indices.create({
        index,
        body: { settings: settings as any, mappings: mappings as any },
      });
    } else {
      // Mapping changes are additive (new fields); putMapping can't remove
      // fields, but a field we stop using is harmless and deleting the index
      // is a manual step.
      await client.indices.putMapping({ index, body: mappings as any });
    }
  }
  return { indexNames: names };
};
