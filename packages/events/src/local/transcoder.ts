/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { LocalTranscodeJobRequest } from '@discava/common-server-utils/local-dev';

// Local dev's stand-in for MediaConvert (#137): transcodes a raw upload to HLS
// with ffmpeg in Docker, writing what the MediaConvert job template does to
// the same place, so applyTranscodeOutcome and playback work unchanged.

/**
 * The renditions, as the MediaConvert job template's
 * (common/constructs/src/app/media-convert/video-transcode-pipeline.ts):
 * name modifier, height and maximum bitrate. Keep the two in step.
 */
export const LADDER = [
  { name: '1080p', height: 1080, maxBitrate: 5_500_000 },
  { name: '720p', height: 720, maxBitrate: 2_750_000 },
  { name: '480p', height: 480, maxBitrate: 1_100_000 },
  { name: '360p', height: 360, maxBitrate: 700_000 },
] as const;

export type Rendition = (typeof LADDER)[number];

/**
 * The renditions to make from a source this tall: none taller than it (where
 * MediaConvert would upscale, this saves time), but always at least the
 * smallest. `only` (LOCAL_TRANSCODE_RENDITIONS) narrows them further, for
 * speed; if it leaves none, the smallest is made.
 */
export const renditionsFor = (
  sourceHeight: number,
  only: readonly string[] = [],
): Rendition[] => {
  const fitting = LADDER.filter(({ height }) => height <= sourceHeight);
  const chosen = fitting.length > 0 ? fitting : [LADDER[LADDER.length - 1]];
  const narrowed = only.length
    ? chosen.filter(({ name }) => only.includes(name))
    : chosen;
  return narrowed.length > 0 ? narrowed : [chosen[chosen.length - 1]];
};

/**
 * ffmpeg's arguments for the HLS ladder, as the MediaConvert job template
 * produces it: H.264 renditions capped at the template's bitrates, AAC
 * 128 kbps 48 kHz stereo, 6 s segments, and the same file names --
 * master.m3u8, master_<rendition>.m3u8, master_<rendition>_NNNNN.ts. ffmpeg
 * applies rotation metadata by default, like the job's `Rotate: AUTO`.
 */
export const ffmpegArgs = (
  renditions: readonly Rendition[],
  hasAudio: boolean,
  input = '/work/input',
  outDir = '/work/out',
): string[] => {
  const scaled = renditions.map(({ height }, i) => `scale=-2:${height}[v${i}]`);
  const filter =
    renditions.length === 1
      ? `[0:v]${scaled[0]}`
      : `[0:v]split=${renditions.length}${renditions.map((_, i) => `[s${i}]`).join('')};${scaled.map((s, i) => `[s${i}]${s}`).join(';')}`;
  return [
    ...['-hide_banner', '-loglevel', 'error', '-y', '-i', input],
    ...['-filter_complex', filter],
    ...renditions.flatMap((_, i) => ['-map', `[v${i}]`]),
    ...(hasAudio ? renditions.flatMap(() => ['-map', '0:a:0']) : []),
    ...['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'],
    ...renditions.flatMap(({ maxBitrate }, i) => [
      `-maxrate:v:${i}`,
      `${maxBitrate}`,
      `-bufsize:v:${i}`,
      `${maxBitrate * 2}`,
    ]),
    // A keyframe every 2 s whatever the frame rate, so 6 s segments split
    // cleanly and line up across renditions.
    ...['-force_key_frames', 'expr:gte(t,n_forced*2)', '-sc_threshold', '0'],
    ...(hasAudio
      ? ['-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2']
      : []),
    ...['-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod'],
    ...['-hls_segment_filename', `${outDir}/master_%v_%05d.ts`],
    ...['-master_pl_name', 'master.m3u8'],
    '-var_stream_map',
    renditions
      .map(({ name }, i) =>
        hasAudio ? `v:${i},a:${i},name:${name}` : `v:${i},name:${name}`,
      )
      .join(' '),
    `${outDir}/master_%v.m3u8`,
  ];
};

/** Runs `docker` with these arguments; `kill` stops the container named. */
export type Docker = (args: string[]) => Promise<{
  code: number;
  stdout: string;
  stderr: string;
}>;

export interface TranscoderOptions {
  docker: Docker;
  /** Stops a running container, by name. */
  killContainer: (name: string) => void;
  s3: S3Client;
  /** The ffmpeg image, holding /ffmpeg (its entrypoint) and /ffprobe. */
  image: string;
  /** Host folder for jobs' files, under the repo's tmp/; mounted into Docker. */
  workDir: string;
  inputBucket: string;
  outputBucket: string;
  /** LOCAL_TRANSCODE_RENDITIONS, e.g. ['360p'], for speed. */
  only?: readonly string[];
  /** Called once a job finishes, as MediaConvert's completion event would. */
  onFinished: (
    jobId: string,
    status: 'COMPLETE' | 'ERROR',
    request: LocalTranscodeJobRequest,
  ) => Promise<void>;
  log: (message: string) => void;
}

const contentType = (file: string) =>
  file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/MP2T';

// ffprobe's container for a job; ffmpeg's is named after the job itself.
const probeContainer = (jobId: string) => `${jobId}-probe`;

interface Job {
  jobId: string;
  request: LocalTranscodeJobRequest;
  canceled: boolean;
}

/**
 * MediaConvert's part, locally: `submit` queues a job and returns its ID
 * straight away; jobs run one at a time. Each downloads the raw upload into
 * its own folder, probes it, runs ffmpeg, and uploads the HLS output -- the
 * segments and rendition playlists first, master.m3u8 last, so a partial
 * upload is never playable -- then reports COMPLETE. A failure removes what
 * it uploaded and reports ERROR, keeping its folder (with ffmpeg's log) to
 * look at. `cancel` drops a queued job, or stops a running one; either way
 * its output is removed and nothing is reported, as for a canceled
 * MediaConvert job whose cleanup the API schedules.
 */
export const createTranscoder = (options: TranscoderOptions) => {
  const { docker, s3, image, workDir, inputBucket, outputBucket } = options;
  const queue: Job[] = [];
  let running: Job | undefined;
  let idle = Promise.resolve();

  // Every object under `prefix`, a page (at most 1,000, the most
  // DeleteObjects takes too) at a time: a long lecture's HLS is thousands.
  const removeOutput = async (prefix: string) => {
    let continuationToken: string | undefined;
    do {
      const { Contents, IsTruncated, NextContinuationToken } = await s3.send(
        new ListObjectsV2Command({
          Bucket: outputBucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const keys = (Contents ?? []).flatMap(({ Key }) =>
        Key ? [{ Key }] : [],
      );
      if (keys.length > 0) {
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: outputBucket,
            Delete: { Objects: keys },
          }),
        );
      }
      continuationToken = IsTruncated ? NextContinuationToken : undefined;
    } while (continuationToken);
  };

  const run = async (job: Job): Promise<'COMPLETE' | 'ERROR' | 'CANCELED'> => {
    const { jobId, request } = job;
    const dir = join(workDir, jobId);
    const outDir = join(dir, 'out');
    const input = `input${extname(request.inputKey)}`;
    const failed = async (step: string, details: string) => {
      await writeFile(join(dir, 'error.log'), `${step}\n${details}\n`);
      options.log(`${jobId} failed at ${step}; its files are in ${dir}`);
      return 'ERROR' as const;
    };
    await mkdir(outDir, { recursive: true });

    const { Body } = await s3.send(
      new GetObjectCommand({ Bucket: inputBucket, Key: request.inputKey }),
    );
    await pipeline(Body as Readable, createWriteStream(join(dir, input)));
    if (job.canceled) return 'CANCELED';

    // Named, like ffmpeg's container, so a cancel can stop it.
    const probe = await docker([
      ...['run', '--rm', '--name', probeContainer(jobId)],
      ...['-v', `${dir}:/work`, '--entrypoint', '/ffprobe'],
      image,
      ...['-v', 'error', '-show_entries', 'stream=codec_type,height'],
      ...['-of', 'json', `/work/${input}`],
    ]);
    if (job.canceled) return 'CANCELED';
    if (probe.code !== 0) return failed('ffprobe', probe.stderr);
    const streams: { codec_type?: string; height?: number }[] =
      JSON.parse(probe.stdout).streams ?? [];
    const video = streams.find(({ codec_type }) => codec_type === 'video');
    if (!video?.height) return failed('ffprobe', 'no video stream');
    const renditions = renditionsFor(video.height, options.only);
    const hasAudio = streams.some(({ codec_type }) => codec_type === 'audio');
    options.log(
      `${jobId}: ${video.height}p source -> ${renditions.map(({ name }) => name).join(', ')}`,
    );

    const ffmpeg = await docker([
      ...['run', '--rm', '--name', jobId, '-v', `${dir}:/work`],
      image,
      ...ffmpegArgs(renditions, hasAudio, `/work/${input}`),
    ]);
    if (job.canceled) return 'CANCELED';
    if (ffmpeg.code !== 0) return failed('ffmpeg', ffmpeg.stderr);

    // master.m3u8 last: until it's there, nothing points at the rest.
    const files = (await readdir(outDir)).sort(
      (a, b) => Number(a === 'master.m3u8') - Number(b === 'master.m3u8'),
    );
    for (const file of files) {
      if (job.canceled) return 'CANCELED';
      await s3.send(
        new PutObjectCommand({
          Bucket: outputBucket,
          Key: `${request.outputPrefix}${file}`,
          Body: await readFile(join(outDir, file)),
          ContentType: contentType(file),
        }),
      );
    }
    await rm(dir, { recursive: true, force: true });
    return 'COMPLETE';
  };

  const next = async () => {
    const job = queue.shift();
    if (!job) return;
    running = job;
    let result: 'COMPLETE' | 'ERROR' | 'CANCELED';
    try {
      result = await run(job);
    } catch (error) {
      options.log(`${job.jobId} failed: ${(error as Error).message}`);
      result = 'ERROR';
    }
    running = undefined;
    if (result !== 'COMPLETE') {
      await removeOutput(job.request.outputPrefix).catch((error: Error) =>
        options.log(
          `${job.jobId}: couldn't remove its output: ${error.message}`,
        ),
      );
    }
    if (result === 'CANCELED') {
      await rm(join(workDir, job.jobId), { recursive: true, force: true });
      options.log(`${job.jobId} canceled`);
    } else {
      options.log(`${job.jobId} ${result}`);
      await options.onFinished(job.jobId, result, job.request);
    }
    await next();
  };

  return {
    /** Queues a job, returning its ID, as MediaConvert's CreateJob does. */
    submit(request: LocalTranscodeJobRequest): string {
      const job = { jobId: `local-${randomUUID()}`, request, canceled: false };
      queue.push(job);
      if (!running && queue.length === 1) {
        idle = next();
      }
      return job.jobId;
    },
    /** Cancels a job; false if there's no such job still to finish. */
    cancel(jobId: string): boolean {
      const queued = queue.findIndex((job) => job.jobId === jobId);
      if (queued >= 0) {
        queue.splice(queued, 1);
        return true;
      }
      if (running?.jobId === jobId) {
        running.canceled = true;
        // Whichever is running; stopping one that isn't does nothing.
        options.killContainer(probeContainer(jobId));
        options.killContainer(jobId);
        return true;
      }
      return false;
    },
    /** Resolves once the queue is empty (for tests and shutdown). */
    idle: () => idle,
  };
};
