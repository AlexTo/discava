/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CloudFormationCustomResourceEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getOpenSearchClientMock, syncIndicesMock } = vi.hoisted(() => ({
  getOpenSearchClientMock: vi.fn(),
  syncIndicesMock: vi.fn(),
}));

vi.mock('../client.js', () => ({
  getOpenSearchClient: getOpenSearchClientMock,
}));
vi.mock('./sync-indices.js', () => ({
  syncIndices: syncIndicesMock,
}));

const { handler } = await import('./handler.js');

const manifest = { hash: 'abc', indices: [] };

const baseEvent = {
  ResourceProperties: { Manifest: JSON.stringify(manifest) },
} as unknown as CloudFormationCustomResourceEvent;

beforeEach(() => {
  getOpenSearchClientMock.mockReset().mockResolvedValue('the-client');
  syncIndicesMock.mockReset().mockResolvedValue(undefined);
});

describe('handler', () => {
  it('syncs indices on Create and Update, with a fixed physical id', async () => {
    for (const RequestType of ['Create', 'Update'] as const) {
      const result = await handler({ ...baseEvent, RequestType });
      expect(syncIndicesMock).toHaveBeenCalledWith('the-client', manifest);
      expect(result).toEqual({
        PhysicalResourceId: 'search-index-sync',
        Data: { Hash: 'abc' },
      });
    }
  });

  it('never syncs on Delete, and still returns the same physical id', async () => {
    const result = await handler({ ...baseEvent, RequestType: 'Delete' });

    expect(syncIndicesMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      PhysicalResourceId: 'search-index-sync',
      Data: { Hash: 'abc' },
    });
  });
});
