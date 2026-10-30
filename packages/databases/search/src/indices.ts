/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Client } from '@opensearch-project/opensearch';
import { type ZodType, z } from 'zod';
import { resolveIndexName } from './client.js';

// One index holds one document type (mapping types are gone since OpenSearch
// 2.0), so a project's indices are the content types it searches across:
// courses, lessons, ... Each index module pairs a Zod schema (the document
// shape, used to validate before a write and to type query results) with the
// explicit mapping/settings for what Zod can't express (analyzers, keyword
// sub-fields, ...). They sit in one module so they can't drift apart.
export interface IndexDefinition<TSchema extends ZodType = ZodType> {
  /** The index's name; the local index is prefixed by resolveIndexName. */
  readonly name: string;
  /** The document schema: validates before a write, types the results. */
  readonly schema: TSchema;
  /** Index settings, for what a mapping can't express (e.g. `index.knn`). */
  readonly settings: Record<string, unknown>;
  /** The document mapping: the fields and their types and analyzers. */
  readonly mappings: Record<string, unknown>;
}

// A bound index: a definition with a client and a resolved index name, so
// index.put / index.search validate against the schema and hit the right
// index. The sync tooling reads only the raw definition (the default export);
// consumers build this at runtime.
export type BoundIndex<TSchema extends ZodType = ZodType> = {
  readonly name: string;
  readonly client: Client;
  readonly index: string;
} & {
  /** Index one document, validated against the schema (idempotent: id = key). */
  put(document: z.output<TSchema>): Promise<void>;
  /** Delete one document by id (REMOVE, unpublish, archive). */
  remove(id: string): Promise<void>;
  /** Search, returning the schema-typed documents. */
  search(request: Record<string, unknown>): Promise<z.output<TSchema>[]>;
};

// createIndex ties a Zod schema and its mapping/settings together into one
// definition, and binds it to a client and resolved index name for use.
// generate-indices-manifest.ts reads each index file's default export (an
// IndexDefinition) and flattens them into indices.json; that manifest is what
// the local sync script and the deploy-time Lambda create/update the real
// indices from, so there's no separate place for the mappings to drift.
export const createIndex = <TSchema extends ZodType>(
  definition: IndexDefinition<TSchema>,
) => {
  const { name, schema } = definition;

  return {
    ...definition,
    bind: ({
      client,
      index = resolveIndexName(name),
    }: {
      client: Client;
      index?: string;
    }): BoundIndex<TSchema> => ({
      name,
      client,
      index,
      async put(document) {
        // Validate before writing, so an invalid record never reaches the
        // index (the stream handler and backfill both go through this).
        schema.parseAsync(document as unknown);
        await client.index({
          index,
          id: (document as { id: string }).id,
          body: document as unknown as Record<string, unknown>,
        });
      },
      async remove(id) {
        // A missing doc is not an error: a REMOVE or a replay of a delete.
        await client.delete({ index, id }, { ignore: [404] });
      },
      async search(request) {
        const { body } = await client.search({
          index,
          body: request,
        });
        return body.hits.hits.map((hit) => hit._source as z.output<TSchema>);
      },
    }),
  };
};
