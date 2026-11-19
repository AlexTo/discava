/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  GetTranscriptionJobCommand,
  StartTranscriptionJobCommand,
  TranscribeClient,
} from '@aws-sdk/client-transcribe';
import {
  previewTranscribeJobName,
  previewTranscribeOutputPrefix,
  transcribeInputKey,
  transcribeJobName,
  transcribeOutputPrefix,
} from '@discava/common-server-utils/captions';
import {
  resolveAppConfigValue,
  resolveLessonMediaBucketName,
  resolveLessonMediaUploadBucketName,
} from '@discava/common-server-utils/lesson-media-bucket';
import {
  callLocalEventRunner,
  isLocalDev,
  type LocalTranscriptionJobRequest,
} from '@discava/common-server-utils/local-dev';

// The language automatic captions are made in, until a course can choose.
const DEFAULT_CAPTION_LANGUAGE = 'en-US';

let _client: TranscribeClient | undefined;
const getTranscribeClient = (): TranscribeClient => {
  if (!_client) {
    _client = new TranscribeClient({});
  }
  return _client;
};

/**
 * The video version a caption job is for: a content item's (no `target`) or
 * a course preview's.
 */
export type CaptionJobTarget =
  | {
      target?: 'contentItem';
      courseId: string;
      moduleId: string;
      lessonId: string;
      contentItemId: string;
      /** The version's manifest nonce. */
      nonce: string;
    }
  | {
      target: 'coursePreview';
      courseId: string;
      /** The version's manifest nonce. */
      nonce: string;
    };

// Published beside the pipeline ARNs, in the `mediaConvert` runtime config;
// not there (or no config at all) means the default.
const resolveCaptionLanguage = async (): Promise<string> => {
  try {
    return await resolveAppConfigValue<string>(
      'mediaConvert',
      'CaptionLanguageCode',
    );
  } catch {
    return DEFAULT_CAPTION_LANGUAGE;
  }
};

/**
 * Starts the automatic captions for a version whose transcode just finished:
 * Transcribe reads the audio-only file the transcode wrote
 * (`transcribe-input/<nonce>.mp4` in the upload bucket) and writes its WebVTT
 * and JSON transcript to the version's scratch folder in the lesson media
 * bucket (never under `<nonce>/*`, which students' cookies authorise). The
 * job's tags let transcribe-complete find the item again. In local dev the
 * event runner stands in for Transcribe.
 */
export const startCaptionJob = async (
  target: CaptionJobTarget,
): Promise<void> => {
  const { nonce } = target;
  // A lesson video's job is tagged as before, with no `target`.
  const { jobName, outputKey, tags } =
    target.target === 'coursePreview'
      ? {
          jobName: previewTranscribeJobName(target.courseId, nonce),
          outputKey: previewTranscribeOutputPrefix(target.courseId, nonce),
          tags: {
            target: 'coursePreview',
            courseId: target.courseId,
            nonce,
          },
        }
      : {
          jobName: transcribeJobName(target.contentItemId, nonce),
          outputKey: transcribeOutputPrefix(target, nonce),
          tags: {
            courseId: target.courseId,
            moduleId: target.moduleId,
            lessonId: target.lessonId,
            contentItemId: target.contentItemId,
            nonce,
          },
        };
  const outputBucket = await resolveLessonMediaBucketName();

  if (isLocalDev()) {
    await callLocalEventRunner<unknown>('POST', '/transcription-jobs', {
      jobName,
      tags,
      outputBucket,
      outputKey,
    } satisfies LocalTranscriptionJobRequest);
    return;
  }

  const uploadBucket = await resolveLessonMediaUploadBucketName();
  await getTranscribeClient().send(
    new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: (await resolveCaptionLanguage()) as never,
      Media: {
        MediaFileUri: `s3://${uploadBucket}/${transcribeInputKey(nonce)}`,
      },
      OutputBucketName: outputBucket,
      OutputKey: outputKey,
      Subtitles: { Formats: ['vtt'] },
      Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
    }),
  );
};

/** What transcribe-complete needs to know about a finished job. */
export type CaptionJob = CaptionJobTarget & {
  status: string;
  /** The WebVTT's key in the lesson media bucket, if Transcribe wrote one. */
  vttKey?: string;
};

// Transcribe reports file locations as https://s3.<region>.amazonaws.com/
// <bucket>/<key>, or as s3://<bucket>/<key>; the key is what's wanted.
export const keyFromS3Uri = (uri: string): string | undefined => {
  const path = uri.startsWith('s3://')
    ? uri.slice('s3://'.length)
    : new URL(uri).pathname.slice(1);
  const key = decodeURIComponent(path.slice(path.indexOf('/') + 1));
  return path.includes('/') && key ? key : undefined;
};

/**
 * A finished caption job: its status, the ids it was tagged with and where
 * its WebVTT is. Throws if the job or its tags can't be found.
 */
export const getCaptionJob = async (jobName: string): Promise<CaptionJob> => {
  const { TranscriptionJob: job } = await getTranscribeClient().send(
    new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }),
  );
  const tags = Object.fromEntries(
    (job?.Tags ?? []).map(({ Key, Value }) => [Key, Value]),
  );
  const { courseId, moduleId, lessonId, contentItemId, nonce } = tags;
  const uri = job?.Subtitles?.SubtitleFileUris?.[0];
  const status = job?.TranscriptionJobStatus ?? 'UNKNOWN';
  const vttKey = uri ? keyFromS3Uri(uri) : undefined;
  if (tags.target === 'coursePreview') {
    if (!courseId || !nonce) {
      throw new Error(`Caption job ${jobName} is missing its tags`);
    }
    return { target: 'coursePreview', status, courseId, nonce, vttKey };
  }
  if (!courseId || !moduleId || !lessonId || !contentItemId || !nonce) {
    throw new Error(`Caption job ${jobName} is missing its tags`);
  }
  return {
    status,
    courseId,
    moduleId,
    lessonId,
    contentItemId,
    nonce,
    vttKey,
  };
};
