/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Client } from '@opensearch-project/opensearch';
import { describe, expect, it, vi } from 'vitest';
import { type IndicesManifest, syncIndices } from './sync-indices.js';

const manifest: IndicesManifest = {
  hash: 'abc',
  indices: [
    {
      name: 'courses',
      settings: { index: { number_of_shards: 1 } },
      mappings: { properties: { courseId: { type: 'keyword' } } },
    },
    {
      name: 'lessons',
      mappings: { properties: { lessonId: { type: 'keyword' } } },
    },
  ],
};

const fakeClient = (existing: Set<string>) => {
  const create = vi.fn().mockResolvedValue({});
  const putMapping = vi.fn().mockResolvedValue({});
  const exists = vi.fn(({ index }: { index: string }) =>
    Promise.resolve({ body: existing.has(index) }),
  );
  return {
    indices: { exists, create, putMapping },
  } as unknown as Client;
};

describe('syncIndices', () => {
  it('creates every index that does not exist yet, with its settings and mappings', async () => {
    const client = fakeClient(new Set());
    await syncIndices(client, manifest);

    expect(client.indices.create).toHaveBeenCalledWith({
      index: 'courses',
      body: {
        settings: manifest.indices[0].settings,
        mappings: manifest.indices[0].mappings,
      },
    });
    expect(client.indices.create).toHaveBeenCalledWith({
      index: 'lessons',
      body: { settings: undefined, mappings: manifest.indices[1].mappings },
    });
    expect(client.indices.putMapping).not.toHaveBeenCalled();
  });

  it('updates the mapping of an index that already exists, without recreating it', async () => {
    const client = fakeClient(new Set(['courses', 'lessons']));
    await syncIndices(client, manifest);

    expect(client.indices.create).not.toHaveBeenCalled();
    expect(client.indices.putMapping).toHaveBeenCalledWith({
      index: 'courses',
      body: manifest.indices[0].mappings,
    });
    expect(client.indices.putMapping).toHaveBeenCalledWith({
      index: 'lessons',
      body: manifest.indices[1].mappings,
    });
  });

  it('never deletes an index, even one no longer in the manifest', async () => {
    const client = fakeClient(new Set(['courses', 'lessons', 'retired']));
    await syncIndices(client, manifest);

    expect(
      (client.indices as unknown as Record<string, unknown>).delete,
    ).toBeUndefined();
  });
});
