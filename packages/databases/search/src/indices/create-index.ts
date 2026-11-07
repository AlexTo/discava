/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ZodType } from 'zod';

/**
 * One OpenSearch index: its zod schema (what the indexing Lambda validates a
 * document against before writing) and its explicit mapping (what OpenSearch
 * is told the document looks like), defined together so they can't drift
 * apart. Settings are index-level config (shards, replicas, analyzers).
 */
export interface IndexDefinition<T> {
  readonly name: string;
  readonly schema: ZodType<T>;
  readonly settings?: Record<string, unknown>;
  readonly mappings: Record<string, unknown>;
}

// Identity function: exists so every index module has the same shape
// (`export default createIndex({...})`), and so a future generator-emitted
// version of this file can validate its input without every index needing
// to import a type.
export const createIndex = <T>(
  definition: IndexDefinition<T>,
): IndexDefinition<T> => definition;
