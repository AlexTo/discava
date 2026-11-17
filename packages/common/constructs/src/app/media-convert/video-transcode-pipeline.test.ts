/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
// (CDK resolves asset paths from import.meta.url, which jsdom doesn't provide.)
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { LessonMediaBucket } from '../s3/lesson-media-bucket.js';
import { LessonMediaUploadBucket } from '../s3/lesson-media-upload-bucket.js';
import { VideoTranscodePipeline } from './video-transcode-pipeline.js';

const synthesize = (enableKmsEncryption: boolean) => {
  const stack = new Stack(new App(), 'Stack', {
    env: { account: 'test-account', region: 'ap-southeast-2' },
  });
  const uploadBucket = new LessonMediaUploadBucket(stack, 'Upload', {
    enableKmsEncryption,
  });
  const mediaBucket = new LessonMediaBucket(stack, 'Media', {
    enableKmsEncryption,
    enableWaf: false,
  });
  new VideoTranscodePipeline(stack, 'Pipeline', { uploadBucket, mediaBucket });
  return Template.fromStack(stack);
};

const outputGroups = (template: Template) => {
  const [{ Properties }] = Object.values(
    template.findResources('AWS::MediaConvert::JobTemplate'),
  ) as { Properties: { SettingsJson: { OutputGroups: any[] } } }[];
  return Properties.SettingsJson.OutputGroups;
};

// Synthesizing can pass Vitest's 5s default when CI runs every project's tests in parallel.
describe('VideoTranscodePipeline', { timeout: 30_000 }, () => {
  it('adds an audio-only MP4 output group, distinct from the HLS one, for Transcribe', () => {
    const groups = outputGroups(synthesize(true));

    expect(groups).toHaveLength(2);
    expect(groups[0].Name).toBe('HLS');
    const audio = groups[1];
    expect(audio.Name).toBe('Transcribe audio');
    expect(audio.OutputGroupSettings.Type).toBe('FILE_GROUP_SETTINGS');
    expect(audio.Outputs).toEqual([
      {
        ContainerSettings: { Container: 'MP4' },
        AudioDescriptions: [
          {
            AudioSourceName: 'Audio Selector 1',
            CodecSettings: {
              Codec: 'AAC',
              AacSettings: expect.any(Object),
            },
          },
        ],
      },
    ]);
    expect(audio.Outputs[0].VideoDescription).toBeUndefined();
  });

  it.each([true, false])(
    'lets the service role write transcribe-input/* in the upload bucket only (KMS: %s)',
    (kms) => {
      const template = synthesize(kms);
      const statements = Object.values(
        template.findResources('AWS::IAM::Policy'),
      ).flatMap(
        (p) =>
          (p as any).Properties.PolicyDocument.Statement as {
            Action: string | string[];
            Resource: unknown;
          }[],
      );
      const puts = statements.filter((s) =>
        [s.Action]
          .flat()
          .some((a) => a === 's3:PutObject' || a === 's3:PutObject*'),
      );
      const json = JSON.stringify(puts);
      expect(json).toContain('/transcribe-input/*');
      if (kms) {
        expect(JSON.stringify(statements)).toContain('kms:GenerateDataKey*');
      }
    },
  );
});
