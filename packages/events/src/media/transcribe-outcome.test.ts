/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Logger } from '@aws-lambda-powertools/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTranscribeOutcome } from './transcribe-outcome.js';

const { get, patch, patchSet, patchRemove, patchWhere, patchGo, s3Send } =
  vi.hoisted(() => ({
    get: vi.fn(),
    patch: vi.fn(),
    patchSet: vi.fn(),
    patchRemove: vi.fn(),
    patchWhere: vi.fn(),
    patchGo: vi.fn(),
    s3Send: vi.fn(),
  }));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: { contentItem: { get, patch } },
  })),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return { send: s3Send };
  }),
  CopyObjectCommand: vi.fn(function (input) {
    return { type: 'copy', ...input };
  }),
  DeleteObjectCommand: vi.fn(function (input) {
    return { type: 'delete', ...input };
  }),
  GetObjectCommand: vi.fn(function (input) {
    return { type: 'get', ...input };
  }),
}));

vi.mock('@discava/common-server-utils/lesson-media-bucket', () => ({
  resolveLessonMediaBucketName: vi.fn(async () => 'media-bucket'),
}));

const conditionalCheckFailedError = (): Error =>
  Object.assign(new Error('The conditional request failed'), {
    cause: Object.assign(new Error('The conditional request failed'), {
      name: 'ConditionalCheckFailedException',
    }),
  });

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

const REF = {
  courseId: 'c1',
  moduleId: 'm1',
  lessonId: 'l1',
  contentItemId: 'i1',
};
const NONCE = 'n1';
const FOLDER = `courses/c1/modules/m1/lessons/l1/content-items/i1`;
const SCRATCH_VTT = `${FOLDER}/transcribe-output/${NONCE}/captions-i1-n1.vtt`;
const SCRATCH_JSON = `${FOLDER}/transcribe-output/${NONCE}/captions-i1-n1.json`;
const SCRATCH_ACCESS_CHECK = `${FOLDER}/transcribe-output/${NONCE}/.write_access_check_file.temp`;
const SCRATCH_FILES = [SCRATCH_VTT, SCRATCH_JSON, SCRATCH_ACCESS_CHECK];

const vttWith = (text: string) => ({
  Body: { transformToString: async () => text },
});
const VTT_WITH_A_CUE = 'WEBVTT\n\n0\n00:00:00.160 --> 00:00:01.870\nHello.\n';

// What S3 returns by default: the scratch WebVTT for a read, nothing otherwise.
const s3Default = async (command: { type: string }) =>
  command.type === 'get' ? vttWith(VTT_WITH_A_CUE) : {};

const outcome = (status: string, overrides = {}) => ({
  jobName: 'captions-i1-n1',
  status,
  ...REF,
  nonce: NONCE,
  vttKey: SCRATCH_VTT,
  ...overrides,
});

const pendingItem = (overrides = {}) => ({
  status: 'ready',
  s3Key: `${FOLDER}/${NONCE}/master.m3u8`,
  captionsStatus: 'pending',
  captionsPendingSince: '2026-01-01T00:00:00.000Z',
  captionTracksRev: 3,
  captionTracks: [],
  ...overrides,
});

const uploadedEnglish = {
  trackId: 'u1',
  nonce: NONCE,
  language: 'en-US',
  label: 'English',
  source: 'uploaded',
  key: `${FOLDER}/${NONCE}/captions/u1.vtt`,
  isDefault: true,
};

const s3Calls = (type: string) =>
  s3Send.mock.calls.map(([c]) => c).filter((c) => c.type === type);

beforeEach(() => {
  vi.clearAllMocks();
  get.mockReturnValue({ go: async () => ({ data: pendingItem() }) });
  patch.mockReturnValue({ set: patchSet });
  patchSet.mockReturnValue({ remove: patchRemove });
  patchRemove.mockReturnValue({ where: patchWhere });
  patchWhere.mockReturnValue({ go: patchGo });
  patchGo.mockResolvedValue({});
  s3Send.mockImplementation(s3Default);
});

describe('applyTranscribeOutcome on COMPLETED', () => {
  it('copies the VTT into the version captions folder and adds the default auto track as ready', async () => {
    await applyTranscribeOutcome(logger, outcome('COMPLETED'));

    const [copy] = s3Calls('copy');
    expect(copy).toMatchObject({
      Bucket: 'media-bucket',
      CopySource: `media-bucket/${SCRATCH_VTT}`,
      ContentType: 'text/vtt',
    });
    expect(copy.Key).toMatch(
      new RegExp(`^${FOLDER}/${NONCE}/captions/[0-9a-f-]{36}\\.vtt$`),
    );
    expect(patch).toHaveBeenCalledWith(REF);
    const set = patchSet.mock.calls[0][0];
    expect(set).toMatchObject({
      captionsStatus: 'ready',
      captionTracksRev: 4,
      captionTracks: [
        {
          nonce: NONCE,
          language: 'en-US',
          label: 'English',
          source: 'auto',
          key: copy.Key,
          isDefault: true,
        },
      ],
    });
    expect(patchRemove).toHaveBeenCalledWith(['captionsPendingSince']);
  });

  it('writes with the revision and version condition', async () => {
    await applyTranscribeOutcome(logger, outcome('COMPLETED'));

    const [where] = patchWhere.mock.calls[0];
    const op = {
      eq: (a: string, v: unknown) => `${a}=${v}`,
      notExists: (a: string) => `!${a}`,
      contains: (a: string, v: string) => `${a}~${v}`,
    };
    expect(
      where({ captionTracksRev: 'rev', status: 'st', s3Key: 'k' }, op),
    ).toBe('rev=3 AND st=ready AND k~/n1/');
  });

  it("deletes the scratch objects, including Transcribe's access check file, after the track is written", async () => {
    await applyTranscribeOutcome(logger, outcome('COMPLETED'));

    expect(s3Calls('delete').map((c) => c.Key)).toEqual(SCRATCH_FILES);
    const [firstDelete] = s3Send.mock.calls
      .map(([c], i) => [c, i] as const)
      .filter(([c]) => c.type === 'delete');
    expect(patchGo.mock.invocationCallOrder[0]).toBeLessThan(
      s3Send.mock.invocationCallOrder[firstDelete[1]],
    );
  });

  it('never writes the JSON transcript, or anything but a .vtt, under captions/', async () => {
    await applyTranscribeOutcome(logger, outcome('COMPLETED'));

    const written = s3Calls('copy').map((c) => c.Key as string);
    expect(written.every((key) => key.endsWith('.vtt'))).toBe(true);
    expect(written.some((key) => key.endsWith('.json'))).toBe(false);
  });

  it('keeps an uploaded track in the same language and still sets ready', async () => {
    get.mockReturnValue({
      go: async () => ({
        data: pendingItem({ captionTracks: [uploadedEnglish] }),
      }),
    });

    await applyTranscribeOutcome(logger, outcome('COMPLETED'));

    expect(s3Calls('copy')).toEqual([]);
    expect(patchSet).toHaveBeenCalledWith({ captionsStatus: 'ready' });
    expect(patchSet.mock.calls[0][0]).not.toHaveProperty('captionTracks');
    expect(s3Calls('delete').map((c) => c.Key)).toEqual(SCRATCH_FILES);
  });

  it.each([
    ['already applied', { captionsStatus: 'ready' }],
    ['replaced since', { s3Key: `${FOLDER}/other/master.m3u8` }],
    ['no longer ready', { status: 'pending' }],
  ])('is a no-op when the video was %s', async (_name, overrides) => {
    get.mockReturnValue({
      go: async () => ({ data: pendingItem(overrides) }),
    });

    await applyTranscribeOutcome(logger, outcome('COMPLETED'));

    expect(patch).not.toHaveBeenCalled();
    expect(s3Calls('copy')).toEqual([]);
    expect(logger.info).toHaveBeenCalled();
  });

  it('is a no-op when the item was deleted', async () => {
    get.mockReturnValue({ go: async () => ({ data: null }) });

    await applyTranscribeOutcome(logger, outcome('COMPLETED'));

    expect(patch).not.toHaveBeenCalled();
    expect(s3Send).not.toHaveBeenCalled();
  });

  it('retries once on a lost race, deleting the unused copy', async () => {
    patchGo.mockRejectedValueOnce(conditionalCheckFailedError());

    await applyTranscribeOutcome(logger, outcome('COMPLETED'));

    expect(s3Calls('copy')).toHaveLength(2);
    const [firstCopy, secondCopy] = s3Calls('copy');
    expect(s3Calls('delete').map((c) => c.Key)).toContain(firstCopy.Key);
    expect(patchSet.mock.calls[1][0].captionTracks[0].key).toBe(secondCopy.Key);
  });

  it('rethrows after losing the race twice', async () => {
    patchGo.mockRejectedValue(conditionalCheckFailedError());

    await expect(
      applyTranscribeOutcome(logger, outcome('COMPLETED')),
    ).rejects.toThrow();
    expect(s3Calls('delete').map((c) => c.Key)).not.toContain(SCRATCH_VTT);
  });

  it('rethrows a transient write failure, keeping the scratch files', async () => {
    patchGo.mockRejectedValue(new Error('DynamoDB is unavailable'));

    await expect(
      applyTranscribeOutcome(logger, outcome('COMPLETED')),
    ).rejects.toThrow('DynamoDB is unavailable');
    expect(s3Calls('delete').map((c) => c.Key)).not.toContain(SCRATCH_VTT);
  });

  it('rethrows a failed copy and writes no track', async () => {
    s3Send.mockRejectedValue(new Error('S3 is unavailable'));

    await expect(
      applyTranscribeOutcome(logger, outcome('COMPLETED')),
    ).rejects.toThrow('S3 is unavailable');
    expect(patch).not.toHaveBeenCalled();
  });

  it('does not fail when deleting a scratch object does', async () => {
    s3Send.mockImplementation(async (command) => {
      if (command.type === 'delete') throw new Error('nope');
      return s3Default(command);
    });

    await expect(
      applyTranscribeOutcome(logger, outcome('COMPLETED')),
    ).resolves.toBeUndefined();
  });
});

describe('applyTranscribeOutcome on COMPLETED without speech', () => {
  it.each([
    ['only the header', 'WEBVTT\n\n'],
    ['nothing', ''],
  ])(
    'marks captions failed and adds no track when the WebVTT holds %s',
    async (_name, text) => {
      s3Send.mockImplementation(async (command) =>
        command.type === 'get' ? vttWith(text) : {},
      );

      await applyTranscribeOutcome(logger, outcome('COMPLETED'));

      expect(s3Calls('copy')).toEqual([]);
      expect(patchSet).toHaveBeenCalledWith({ captionsStatus: 'failed' });
      expect(patchSet.mock.calls[0][0]).not.toHaveProperty('captionTracks');
      expect(patchRemove).toHaveBeenCalledWith(['captionsPendingSince']);
      expect(s3Calls('delete').map((c) => c.Key)).toEqual(SCRATCH_FILES);
    },
  );
});

describe('applyTranscribeOutcome on FAILED', () => {
  it('sets failed, conditioned on the version still waiting', async () => {
    await applyTranscribeOutcome(logger, outcome('FAILED'));

    expect(patchSet).toHaveBeenCalledWith({ captionsStatus: 'failed' });
    expect(patchRemove).toHaveBeenCalledWith(['captionsPendingSince']);
    const [where] = patchWhere.mock.calls[0];
    const op = {
      eq: (a: string, v: unknown) => `${a}=${v}`,
      contains: (a: string, v: string) => `${a}~${v}`,
    };
    expect(where({ status: 'st', s3Key: 'k', captionsStatus: 'cs' }, op)).toBe(
      'st=ready AND k~/n1/ AND cs=pending',
    );
  });

  it('is a no-op when the version changed', async () => {
    patchGo.mockRejectedValue(conditionalCheckFailedError());

    await expect(
      applyTranscribeOutcome(logger, outcome('FAILED')),
    ).resolves.toBeUndefined();
  });

  it('rethrows a transient failure', async () => {
    patchGo.mockRejectedValue(new Error('DynamoDB is unavailable'));

    await expect(
      applyTranscribeOutcome(logger, outcome('FAILED')),
    ).rejects.toThrow('DynamoDB is unavailable');
  });
});

describe('applyTranscribeOutcome on other statuses', () => {
  it('ignores them', async () => {
    await applyTranscribeOutcome(logger, outcome('IN_PROGRESS'));

    expect(get).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });
});
