/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Names } from 'aws-cdk-lib';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { CfnJobTemplate } from 'aws-cdk-lib/aws-mediaconvert';
import { Construct } from 'constructs';
import { MediaBucket } from '../../core/media-bucket.js';
import { addSetting } from '../../core/settings.js';
import { UploadBucket } from '../../core/upload-bucket.js';

export interface VideoTranscodePipelineProps {
  /** Bucket the raw, untranscoded upload is read from. */
  readonly uploadBucket: UploadBucket;
  /** Bucket the transcoded HLS output is written to. */
  readonly mediaBucket: MediaBucket;
}

// 4-rung H.264/AAC ABR ladder. QVBR quality levels skew high for the top
// rung since lesson content is disproportionately slides/code/screen
// recordings, where compression artifacts on text are the most noticeable
// -- AWS's own guidance puts 6-9 as the typical broadcast-quality range:
// https://docs.aws.amazon.com/mediaconvert/latest/ug/video-quality.html
//
// Deliberately manual, not Automated ABR: Automated ABR requires
// Professional-tier 2-pass encoding (~2.8x the per-minute cost of Basic-tier
// single-pass, per https://aws.amazon.com/mediaconvert/pricing/) just to
// avoid upscaling past the source. Each rendition uses FIT_NO_UPSCALE
// instead, so a small source isn't upscaled, though every rung is still
// produced (skipping rungs would need the source's resolution before
// submitting the job).
//
// `Destination` is a placeholder: each CreateJob call overrides it with the
// content item's output prefix. The template has no `Inputs`, which
// CreateJobTemplate rejects ("isn't supported: FileInput"); submitTranscodeJob
// (mediaconvert-client.ts) sets them per job.
const buildSettingsJson = () => ({
  OutputGroups: [
    {
      Name: 'HLS',
      OutputGroupSettings: {
        Type: 'HLS_GROUP_SETTINGS',
        HlsGroupSettings: {
          Destination: 's3://placeholder/',
          SegmentLength: 6,
          MinSegmentLength: 0,
          DirectoryStructure: 'SINGLE_DIRECTORY',
          ManifestDurationFormat: 'INTEGER',
          OutputSelection: 'MANIFESTS_AND_SEGMENTS',
          StreamInfResolution: 'INCLUDE',
        },
      },
      Outputs: [
        buildRendition('1080p', 1920, 1080, 5_500_000, 8),
        buildRendition('720p', 1280, 720, 2_750_000, 7),
        buildRendition('480p', 854, 480, 1_100_000, 7),
        buildRendition('360p', 640, 360, 700_000, 7),
      ],
    },
    // The same audio as an MP4 for Amazon Transcribe, which reads whole media
    // files, not HLS segments (and the raw upload is deleted on completion).
    // `Destination` is overridden per job, like the HLS one.
    {
      Name: 'Transcribe audio',
      OutputGroupSettings: {
        Type: 'FILE_GROUP_SETTINGS',
        FileGroupSettings: { Destination: 's3://placeholder/' },
      },
      Outputs: [
        {
          ContainerSettings: { Container: 'MP4' },
          AudioDescriptions: [
            {
              AudioSourceName: 'Audio Selector 1',
              CodecSettings: {
                Codec: 'AAC',
                AacSettings: {
                  Bitrate: 64_000,
                  CodingMode: 'CODING_MODE_2_0',
                  SampleRate: 48_000,
                },
              },
            },
          ],
        },
      ],
    },
  ],
});

const buildRendition = (
  nameModifier: string,
  width: number,
  height: number,
  maxBitrate: number,
  qvbrQualityLevel: number,
) => ({
  NameModifier: `_${nameModifier}`,
  ContainerSettings: { Container: 'M3U8' },
  VideoDescription: {
    Width: width,
    Height: height,
    // Keeps a source smaller than this rendition's target at its own size,
    // with no padding: a 720p source in the "1080p" slot comes out at
    // 1280x720, not upscaled to 1920x1080.
    // https://docs.aws.amazon.com/mediaconvert/latest/ug/video-scaling-fit-without-upscaling.html
    ScalingBehavior: 'FIT_NO_UPSCALE',
    CodecSettings: {
      Codec: 'H_264',
      H264Settings: {
        RateControlMode: 'QVBR',
        MaxBitrate: maxBitrate,
        QvbrSettings: { QvbrQualityLevel: qvbrQualityLevel },
        // Manual (non-Automated-ABR) QVBR, and we don't set
        // QvbrSettings.MaxAverageBitrate -- AWS's own guidance is to use
        // Single-pass HQ in exactly this case, reserving Multi-pass HQ
        // (2x the cost) for when Max average bitrate or Automated ABR
        // requires it. https://docs.aws.amazon.com/mediaconvert/latest/ug/qvbr-guidelines.html
        QualityTuningLevel: 'SINGLE_PASS_HQ',
        CodecProfile: 'HIGH',
        CodecLevel: 'AUTO',
        // AWS recommends leaving GOP size blank with GopSizeUnits: AUTO for
        // any HLS/DASH/CMAF output, so MediaConvert can pick a size that
        // divides evenly into the segment length regardless of the input's
        // frame rate -- a fixed frame count (e.g. 90) only aligns with our
        // 6-second segments at exactly 30fps.
        // https://docs.aws.amazon.com/mediaconvert/latest/ug/video-quality.html
        GopSizeUnits: 'AUTO',
        // Both recommended on the same page to improve quality relative to
        // bitrate; neither is set by default.
        DynamicSubGop: 'ADAPTIVE',
        GopBReference: 'ENABLED',
        AdaptiveQuantization: 'AUTO',
        SceneChangeDetect: 'TRANSITION_DETECTION',
      },
    },
  },
  AudioDescriptions: [
    {
      AudioSourceName: 'Audio Selector 1',
      CodecSettings: {
        Codec: 'AAC',
        AacSettings: {
          Bitrate: 128_000,
          CodingMode: 'CODING_MODE_2_0',
          SampleRate: 48_000,
        },
      },
    },
  ],
});

/**
 * The AWS MediaConvert side of the transcode pipeline: an ABR-ladder job
 * template shared by every transcode job, and the service role MediaConvert
 * assumes to read the raw upload and write HLS output. instructor-api submits
 * the jobs, and the completion handlers are Lambdas in `packages/events`
 * (see MediaPipelineStack); neither is part of this construct.
 */
export class VideoTranscodePipeline extends Construct {
  public readonly role: Role;
  public readonly jobTemplate: CfnJobTemplate;

  constructor(
    scope: Construct,
    id: string,
    { uploadBucket, mediaBucket }: VideoTranscodePipelineProps,
  ) {
    super(scope, id);

    this.role = new Role(this, 'Role', {
      assumedBy: new ServicePrincipal('mediaconvert.amazonaws.com'),
    });
    uploadBucket.grantRead(this.role);
    // The audio-only file Transcribe reads (see captions' transcribeInputKey).
    uploadBucket.grantPut(this.role, 'transcribe-input/*');
    mediaBucket.grantPut(this.role);

    this.jobTemplate = new CfnJobTemplate(this, 'JobTemplate', {
      name: Names.uniqueResourceName(this, { maxLength: 128 }),
      settingsJson: buildSettingsJson(),
    });
  }

  /** Gives `fn` the pipeline's deploy-time `mediaConvert` setting. */
  public bindSettings(fn: LambdaFunction): void {
    addSetting(fn, 'mediaConvert', 'VideoTranscodePipeline', this.settings);
  }

  private get settings() {
    return {
      roleArn: this.role.roleArn,
      jobTemplateArn: this.jobTemplate.attrArn,
    };
  }
}
