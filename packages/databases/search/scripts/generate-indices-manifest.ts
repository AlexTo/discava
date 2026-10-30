/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// Run by the `indices` Nx target. The only script in the project that ever
// imports the TS index files directly: it lists src/indices/, takes each file's
// default export (the IndexDefinition), and flattens them into indices.json.
// Local dev's sync script and the deploy-time Lambda read that manifest, so
// they never import the TS — there's one source of truth for the mappings.
//
// Conventions (see the design in #1267): one index per file, and the
// IndexDefinition is always the default export.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IndexDefinition } from '../src/indices.js';

const indicesDir = join(import.meta.dirname, '../src/indices');

const indexFiles = readdirSync(indicesDir)
  .filter((file) => file.endsWith('.ts'))
  .sort();

const manifest: { name: string; settings: unknown; mappings: unknown }[] = [];
for (const file of indexFiles) {
  const mod = await import(pathToFileURL(join(indicesDir, file)).href);
  const { name, settings, mappings } = mod.default as IndexDefinition;
  manifest.push({ name, settings, mappings });
}

const outPath = process.argv[2];
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(manifest, null, 2));
console.log(
  `Wrote ${manifest.length} index(es): ${manifest.map((i) => i.name).join(', ')}`,
);
