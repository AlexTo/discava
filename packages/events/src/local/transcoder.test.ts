/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTranscoder,
  type Docker,
  ffmpegArgs,
  LADDER,
  renditionsFor,
} from './transcoder.js';

describe('renditionsFor', () => {
  it('makes the whole ladder from a 1080p source', () => {
    expect(renditionsFor(1080).map(({ name }) => name)).toEqual([
      '1080p',
      '720p',
      '480p',
      '360p',
    ]);
  });

  it('skips renditions taller than the source', () => {
    expect(renditionsFor(720).map(({ name }) => name)).toEqual([
      '720p',
      '480p',
      '360p',
    ]);
  });

  it('still makes the smallest from a tiny source', () => {
    expect(renditionsFor(240)).toEqual([LADDER[3]]);
  });

  it('makes only the renditions asked for, or else the smallest', () => {
    expect(renditionsFor(1080, ['360p']).map(({ name }) => name)).toEqual([
      '360p',
    ]);
    expect(renditionsFor(480, ['1080p']).map(({ name }) => name)).toEqual([
      '360p',
    ]);
  });
});

describe('ffmpegArgs', () => {
  const args = ffmpegArgs(renditionsFor(720), true);
  const value = (flag: string) => args[args.indexOf(flag) + 1];

  it('writes HLS named as MediaConvert names it', () => {
    expect(value('-master_pl_name')).toBe('master.m3u8');
    expect(value('-hls_segment_filename')).toBe('/work/out/master_%v_%05d.ts');
    expect(args.at(-1)).toBe('/work/out/master_%v.m3u8');
    expect(value('-var_stream_map')).toBe(
      'v:0,a:0,name:720p v:1,a:1,name:480p v:2,a:2,name:360p',
    );
    expect(value('-hls_time')).toBe('6');
  });

  it('caps each rendition at the job template’s bitrate', () => {
    expect(value('-maxrate:v:0')).toBe('2750000');
    expect(value('-maxrate:v:2')).toBe('700000');
    expect(value('-filter_complex')).toBe(
      '[0:v]split=3[s0][s1][s2];[s0]scale=-2:720[v0];[s1]scale=-2:480[v1];[s2]scale=-2:360[v2]',
    );
  });

  it('encodes audio as the template does, and leaves it out when there is none', () => {
    expect(args.join(' ')).toContain('-c:a aac -b:a 128k -ar 48000 -ac 2');
    const silent = ffmpegArgs(renditionsFor(360), false);
    expect(silent).not.toContain('-c:a');
    expect(silent[silent.indexOf('-var_stream_map') + 1]).toBe('v:0,name:360p');
  });
});

describe('createTranscoder', () => {
  const REQUEST = {
    inputKey: 'courses/c/raw/upload-1.mp4',
    outputPrefix: 'courses/c/content-items/i/nonce-1/',
    userMetadata: { contentItemId: 'i', submissionNonce: 'nonce-1' },
  };
  let workDir: string;
  let uploaded: { Key: string; ContentType: string }[];
  let deleted: string[];
  let s3: { send: ReturnType<typeof vi.fn> };

  // ffprobe answers with a 720p video and an audio stream; ffmpeg writes a
  // rendition's playlist and segment plus the master playlist.
  const ffmpegWrites = async (args: string[]) => {
    const dir = args[args.indexOf('-v') + 1].split(':')[0];
    for (const file of [
      'master_720p_00000.ts',
      'master_720p.m3u8',
      'master.m3u8',
    ]) {
      await writeFile(join(dir, 'out', file), file);
    }
  };

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'transcoder-'));
    uploaded = [];
    deleted = [];
    s3 = {
      send: vi.fn(
        async (command: {
          constructor: { name: string };
          input: Record<string, unknown>;
        }) => {
          switch (command.constructor.name) {
            case 'GetObjectCommand':
              return { Body: Readable.from(['raw video']) };
            case 'PutObjectCommand':
              uploaded.push({
                Key: command.input.Key as string,
                ContentType: command.input.ContentType as string,
              });
              return {};
            case 'ListObjectsV2Command':
              return { Contents: uploaded.map(({ Key }) => ({ Key })) };
            case 'DeleteObjectsCommand':
              deleted.push(
                ...(
                  command.input.Delete as { Objects: { Key: string }[] }
                ).Objects.map(({ Key }) => Key),
              );
              return {};
            default:
              throw new Error(command.constructor.name);
          }
        },
      ),
    };
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  const transcoder = (docker: Docker, killContainer = vi.fn()) => {
    const onFinished = vi.fn(async () => {});
    const instance = createTranscoder({
      docker,
      killContainer,
      s3: s3 as never,
      image: 'ffmpeg-image',
      workDir,
      inputBucket: 'uploads',
      outputBucket: 'media',
      onFinished,
      log: () => {},
    });
    return { instance, onFinished, killContainer };
  };

  const probeThenEncode =
    (
      encode: (args: string[]) => Promise<{ code: number; stderr: string }>,
    ): Docker =>
    async (args) =>
      args.includes('/ffprobe')
        ? {
            code: 0,
            stdout: JSON.stringify({
              streams: [
                { codec_type: 'video', height: 720 },
                { codec_type: 'audio' },
              ],
            }),
            stderr: '',
          }
        : { stdout: '', ...(await encode(args)) };

  it('uploads the HLS, master playlist last, then reports COMPLETE and tidies up', async () => {
    const { instance, onFinished } = transcoder(
      probeThenEncode(async (args) => {
        await ffmpegWrites(args);
        return { code: 0, stderr: '' };
      }),
    );

    const jobId = instance.submit(REQUEST);
    await instance.idle();

    expect(jobId).toMatch(/^local-[0-9a-f-]{36}$/);
    expect(uploaded.at(-1)).toEqual({
      Key: `${REQUEST.outputPrefix}master.m3u8`,
      ContentType: 'application/vnd.apple.mpegurl',
    });
    expect(uploaded).toContainEqual({
      Key: `${REQUEST.outputPrefix}master_720p_00000.ts`,
      ContentType: 'video/MP2T',
    });
    expect(onFinished).toHaveBeenCalledExactlyOnceWith(
      jobId,
      'COMPLETE',
      REQUEST,
    );
    expect(existsSync(join(workDir, jobId))).toBe(false);
  });

  it('reports ERROR when ffmpeg fails, keeping its files and log to look at', async () => {
    const { instance, onFinished } = transcoder(
      probeThenEncode(async () => ({ code: 1, stderr: 'Invalid data found' })),
    );

    const jobId = instance.submit(REQUEST);
    await instance.idle();

    expect(onFinished).toHaveBeenCalledExactlyOnceWith(jobId, 'ERROR', REQUEST);
    expect(await readFile(join(workDir, jobId, 'error.log'), 'utf8')).toContain(
      'Invalid data found',
    );
  });

  it('runs jobs one at a time, in order', async () => {
    const started: string[] = [];
    const { instance, onFinished } = transcoder(
      probeThenEncode(async (args) => {
        started.push(args[args.indexOf('--name') + 1]);
        await ffmpegWrites(args);
        return { code: 0, stderr: '' };
      }),
    );

    const first = instance.submit(REQUEST);
    const second = instance.submit(REQUEST);
    await instance.idle();

    expect(started).toEqual([first, second]);
    expect(onFinished.mock.calls.map(([jobId]) => jobId)).toEqual([
      first,
      second,
    ]);
  });

  it('drops a canceled job that hasn’t started, reporting nothing', async () => {
    const { instance, onFinished } = transcoder(
      probeThenEncode(async (args) => {
        await ffmpegWrites(args);
        return { code: 0, stderr: '' };
      }),
    );

    const first = instance.submit(REQUEST);
    const second = instance.submit(REQUEST);
    expect(instance.cancel(second)).toBe(true);
    await instance.idle();

    expect(onFinished.mock.calls.map(([jobId]) => jobId)).toEqual([first]);
  });

  it('stops a running job, removing its output and reporting nothing', async () => {
    let finishEncode: () => void = () => {};
    const { instance, onFinished, killContainer } = transcoder(
      probeThenEncode(async (args) => {
        await ffmpegWrites(args);
        await new Promise<void>((resolve) => {
          finishEncode = resolve;
        });
        return { code: 137, stderr: 'killed' };
      }),
    );

    const jobId = instance.submit(REQUEST);
    await vi.waitFor(() =>
      expect(existsSync(join(workDir, jobId, 'out', 'master.m3u8'))).toBe(true),
    );
    expect(instance.cancel(jobId)).toBe(true);
    finishEncode();
    await instance.idle();

    expect(killContainer).toHaveBeenCalledWith(jobId);
    expect(onFinished).not.toHaveBeenCalled();
    expect(existsSync(join(workDir, jobId))).toBe(false);
    expect(instance.cancel(jobId)).toBe(false);
  });
});
