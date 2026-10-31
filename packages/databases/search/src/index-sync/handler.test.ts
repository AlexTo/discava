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

  it('retries while the data access policy is still taking effect (403)', async () => {
    vi.useFakeTimers();
    try {
      const forbidden = Object.assign(new Error('forbidden'), {
        statusCode: 403,
      });
      syncIndicesMock
        .mockRejectedValueOnce(forbidden)
        .mockRejectedValueOnce(forbidden)
        .mockResolvedValueOnce(undefined);

      const pending = handler({ ...baseEvent, RequestType: 'Create' });
      await vi.advanceTimersByTimeAsync(20_000);

      await expect(pending).resolves.toMatchObject({ Data: { Hash: 'abc' } });
      expect(syncIndicesMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up on a 403 that never clears, and fails at once on any other error', async () => {
    vi.useFakeTimers();
    try {
      const forbidden = Object.assign(new Error('forbidden'), {
        meta: { statusCode: 403 },
      });
      syncIndicesMock.mockRejectedValue(forbidden);
      const stuck = handler({ ...baseEvent, RequestType: 'Create' });
      const settled = expect(stuck).rejects.toThrow('forbidden');
      await vi.advanceTimersByTimeAsync(10_000 * 20);
      await settled;
      expect(syncIndicesMock).toHaveBeenCalledTimes(13);

      syncIndicesMock.mockReset().mockRejectedValue(new Error('bad mapping'));
      await expect(
        handler({ ...baseEvent, RequestType: 'Update' }),
      ).rejects.toThrow('bad mapping');
      expect(syncIndicesMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
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
