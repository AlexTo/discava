/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import type { Logger } from '@aws-lambda-powertools/logger';
import {
  CancelJobCommand,
  CreateJobCommand,
  MediaConvertClient,
} from '@aws-sdk/client-mediaconvert';
import { transcribeInputKey } from '@discava/common-server-utils/captions';
import { scheduleTranscodeCleanup } from '@discava/common-server-utils/cleanup-scheduler';
import {
  resolveLessonMediaBucketName,
  resolveLessonMediaUploadBucketName,
} from '@discava/common-server-utils/lesson-media-bucket';
import {
  callLocalEventRunner,
  isLocalDev,
  type LocalTranscodeJobRequest,
} from '@discava/common-server-utils/local-dev';
import { readSetting } from '@discava/common-server-utils/settings';

// MediaConvert accepts requests at the regional endpoint, so no
// DescribeEndpoints lookup is needed.
let _client: MediaConvertClient | undefined;

const getMediaConvertClient = (): MediaConvertClient => {
  if (!_client) {
    _client = new MediaConvertClient({});
  }
  return _client;
};

const resolveVideoTranscodePipelineConfig = () =>
  readSetting('mediaConvert', 'VideoTranscodePipeline', [
    'roleArn',
    'jobTemplateArn',
  ]);

/**
 * What to transcode: a lesson's content item (`target` omitted) or a course's
 * preview video.
 */
export type TranscodeJobRequest =
  | {
      target?: 'contentItem';
      courseId: string;
      moduleId: string;
      lessonId: string;
      contentItemId: string;
      objectKey: string;
      submissionNonce: string;
    }
  | {
      target: 'coursePreview';
      courseId: string;
      objectKey: string;
      submissionNonce: string;
    };

/**
 * Submits a MediaConvert job transcoding a just-uploaded video into HLS.
 * Callers call it only after writing the DynamoDB record, so the completion
 * callback that later patches that record can never fire first. Returns the
 * new job's id so the caller can stamp it onto that same record --
 * transcode-complete.ts uses it to ignore a stale completion event from a
 * job a later replacement has since superseded.
 *
 * `submissionNonce` (hashed) becomes MediaConvert's `ClientRequestToken`. A
 * caller retrying after a crash (e.g. between this returning and the job id
 * being stamped) passes the nonce it already persisted, so CreateJob returns
 * the existing job; a new submission always gets a fresh nonce. The token
 * never depends on the file's content, so an identical upload can't dedupe
 * onto an unrelated old job.
 */
export const submitTranscodeJob = async (
  job: TranscodeJobRequest,
): Promise<string> => {
  const { courseId, objectKey, submissionNonce } = job;
  // A lesson video's job carries no `target` in its metadata (handlers read
  // none as `contentItem`); a preview's does, and its output goes under the
  // course's preview folder.
  const isPreview = job.target === 'coursePreview';
  const { moduleId, lessonId, contentItemId } = isPreview
    ? { moduleId: '', lessonId: '', contentItemId: '' }
    : job;
  const outputFolder = isPreview
    ? `courses/${courseId}/preview/${submissionNonce}`
    : `courses/${courseId}/modules/${moduleId}/lessons/${lessonId}/content-items/${contentItemId}/${submissionNonce}`;
  const userMetadata: Record<string, string> = isPreview
    ? {
        target: 'coursePreview',
        courseId,
        rawObjectKey: objectKey,
        submissionNonce,
      }
    : {
        courseId,
        moduleId,
        lessonId,
        contentItemId,
        rawObjectKey: objectKey,
        submissionNonce,
      };
  // Local dev transcodes with ffmpeg in the event runner instead (#137): same
  // output path and metadata, and it reports back as MediaConvert would.
  if (isLocalDev()) {
    const response = await callLocalEventRunner<{ jobId: string }>(
      'POST',
      '/transcode-jobs',
      {
        inputKey: objectKey,
        outputPrefix: `${outputFolder}/`,
        userMetadata,
      } satisfies LocalTranscodeJobRequest,
    );
    if (!response?.jobId) {
      throw new Error('The local event runner returned no job ID');
    }
    return response.jobId;
  }

  const [{ roleArn, jobTemplateArn }, uploadBucketName, mediaBucketName] =
    await Promise.all([
      resolveVideoTranscodePipelineConfig(),
      resolveLessonMediaUploadBucketName(),
      resolveLessonMediaBucketName(),
    ]);

  // Scoped by submissionNonce so a canceled job's in-flight writes never
  // share a path with the job replacing it (MediaConvert's job id doesn't
  // exist until CreateJob returns, too late for Destination). MediaConvert
  // names every output from Destination's last segment: "master" gives
  // master.m3u8 with renditions like master_1080p.m3u8 beside it.
  const destination = `s3://${mediaBucketName}/${outputFolder}/master`;

  // The audio-only group's file for Transcribe: MediaConvert appends the
  // container's extension, so this becomes transcribe-input/<nonce>.mp4.
  const transcribeDestination = `s3://${uploadBucketName}/${transcribeInputKey(
    submissionNonce,
  ).replace(/\.mp4$/, '')}`;

  // ClientRequestToken caps out at 64 ASCII characters; hashing keeps this
  // well within that regardless of contentItemId/nonce length.
  const clientRequestToken = createHash('sha256')
    .update(
      `${isPreview ? `preview:${courseId}` : contentItemId}:${submissionNonce}`,
    )
    .digest('hex')
    .slice(0, 32);

  const { Job } = await getMediaConvertClient().send(
    new CreateJobCommand({
      ClientRequestToken: clientRequestToken,
      Role: roleArn,
      JobTemplate: jobTemplateArn,
      // rawObjectKey lets the completion callback delete the raw upload
      // without needing to guess its extension back from just the 4 ids.
      // submissionNonce lets it reconstruct this same job's nonce-scoped
      // manifest path without needing to parse Destination back out of
      // the job's own settings.
      UserMetadata: userMetadata,
      Settings: {
        // AudioSelectors/TimecodeSource are per-input, not settable on the
        // job template (MediaConvert's CreateJobTemplate API rejects an
        // Inputs property outright) -- 'Audio Selector 1' is what every
        // rendition's AudioDescriptions.AudioSourceName in the template
        // refers to, so it must be defined here on the job's own input.
        Inputs: [
          {
            FileInput: `s3://${uploadBucketName}/${objectKey}`,
            AudioSelectors: {
              'Audio Selector 1': { DefaultSelection: 'DEFAULT' },
            },
            TimecodeSource: 'ZEROBASED',
            // MediaConvert's own default is to ignore rotation metadata
            // entirely, even when present -- without this, a phone-shot
            // portrait upload (rotation metadata on an otherwise landscape
            // frame, the ordinary case for a phone camera) transcodes
            // sideways. AUTO applies it when present and within 1 degree
            // of 90/180/270; does nothing otherwise.
            VideoSelector: { Rotate: 'AUTO' },
          },
        ],
        OutputGroups: [
          {
            OutputGroupSettings: {
              Type: 'HLS_GROUP_SETTINGS',
              HlsGroupSettings: { Destination: destination },
            },
          },
          {
            OutputGroupSettings: {
              Type: 'FILE_GROUP_SETTINGS',
              FileGroupSettings: { Destination: transcribeDestination },
            },
          },
        ],
      },
    }),
  );

  if (!Job?.Id) {
    throw new Error('MediaConvert CreateJob response is missing Job.Id');
  }

  return Job.Id;
};

export type ICancelableTranscodeJob = {
  jobId: string;
  courseId: string;
  submissionNonce?: string;
} & (
  | {
      target?: 'contentItem';
      moduleId: string;
      lessonId: string;
      contentItemId: string;
    }
  | { target: 'coursePreview' }
);

/**
 * Cancels a MediaConvert job that no longer has anywhere to report to --
 * either a replacement upload has superseded it, or the content item it was
 * transcoding for has been deleted -- best-effort, since the job may already
 * be too far along to cancel, or already finished, and the caller (a video
 * mutation or delete) must still succeed regardless. transcodeComplete's
 * mediaConvertJobId check is what actually guards DynamoDB against a
 * replacement job this fails to stop; for a delete there's no longer any
 * record to guard.
 *
 * Also schedules a delayed cleanup of this job's own S3 output (see
 * scheduleTranscodeCleanup) -- whether or not the cancel above actually
 * succeeds. The caller has already decided to supersede or delete this
 * content item's video regardless, so even a job that happened to finish
 * on its own moments before the cancel landed has nothing left pointing
 * at its output; scheduling cleanup for it is still correct.
 */
export const bestEffortCancelTranscodeJob = async (
  logger: Logger | undefined,
  job: ICancelableTranscodeJob,
): Promise<void> => {
  try {
    if (isLocalDev()) {
      await callLocalEventRunner(
        'DELETE',
        `/transcode-jobs/${encodeURIComponent(job.jobId)}`,
      );
    } else {
      await getMediaConvertClient().send(
        new CancelJobCommand({ Id: job.jobId }),
      );
    }
  } catch (error) {
    logger?.error('Failed to cancel transcode job', {
      error,
      jobId: job.jobId,
    });
  }

  // A job with no submissionNonce has no folder to scope a cleanup to.
  if (job.submissionNonce !== undefined) {
    await scheduleTranscodeCleanup(
      logger,
      job.target === 'coursePreview'
        ? {
            target: 'coursePreview',
            courseId: job.courseId,
            submissionNonce: job.submissionNonce,
          }
        : {
            courseId: job.courseId,
            moduleId: job.moduleId,
            lessonId: job.lessonId,
            contentItemId: job.contentItemId,
            submissionNonce: job.submissionNonce,
          },
    );
  }
};

export type ICancelableVideoContentItem = {
  status: string;
  mediaConvertJobId?: string;
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
  submissionNonce?: string;
};

/**
 * Cancels the still-running transcode job (if any) for each content item
 * that's mid-transcode, best-effort. A `'ready'`/`'failed'` item has no job
 * left to cancel. A `'pending'` item with no `mediaConvertJobId` can also
 * have a real, running job -- a stamp-only submission failure leaves it in
 * exactly that state (see content-item-video.ts) -- but `CancelJob` needs
 * an id this attempt was never able to save, so it can't be canceled early
 * here. Its eventual output isn't left orphaned, though: `transcode-
 * complete.ts` schedules cleanup itself once that job's own completion
 * event tells it this record no longer wants the result.
 */
export const bestEffortCancelTranscodeJobs = async (
  logger: Logger | undefined,
  contentItems: readonly ICancelableVideoContentItem[],
): Promise<void> => {
  await Promise.all(
    contentItems
      .filter(
        (
          item,
        ): item is ICancelableVideoContentItem & {
          mediaConvertJobId: string;
        } => item.status === 'pending' && !!item.mediaConvertJobId,
      )
      .map((item) =>
        bestEffortCancelTranscodeJob(logger, {
          jobId: item.mediaConvertJobId,
          courseId: item.courseId,
          moduleId: item.moduleId,
          lessonId: item.lessonId,
          contentItemId: item.contentItemId,
          submissionNonce: item.submissionNonce,
        }),
      ),
  );
};
