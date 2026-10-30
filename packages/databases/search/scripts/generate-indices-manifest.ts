/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDICES } from '../src/indices/index.js';

// The one manifest both local dev (sync-local-indices.ts) and CDK
// (OpenSearchCollection's index-sync custom resource) read, so they can
// never see a different set of indices. Only settings/mappings are kept --
// the zod schema stays in src/indices, used only by the indexing Lambda.
const manifest = {
  indices: INDICES.map(({ name, settings, mappings }) => ({
    name,
    settings,
    mappings,
  })),
};

// The custom resource's ManifestHash property changes exactly when this
// does, which is what makes CloudFormation re-run index-sync on deploy.
const hash = createHash('sha256')
  .update(JSON.stringify(manifest))
  .digest('hex');

const outPath = fileURLToPath(
  new URL(
    '../../../../dist/packages/databases/search/indices/indices.json',
    import.meta.url,
  ),
);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ ...manifest, hash }, null, 2));
console.log(`Wrote ${outPath}`);
