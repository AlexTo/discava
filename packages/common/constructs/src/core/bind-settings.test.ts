/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
// (CDK resolves asset paths from import.meta.url, which jsdom doesn't provide.)
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { describe, expect, it } from 'vitest';
import { CoreTable } from '../app/dynamodb/core-table.js';
import { VideoTranscodePipeline } from '../app/media-convert/video-transcode-pipeline.js';
import { LessonMediaBucket } from '../app/s3/lesson-media-bucket.js';
import { LessonMediaUploadBucket } from '../app/s3/lesson-media-upload-bucket.js';
import { PublicMediaBucket } from '../app/s3/public-media-bucket.js';
import { OpenSearchCollection } from './opensearch.js';

class TestCollection extends OpenSearchCollection {}

const setup = () => {
  const stack = new Stack(new App(), 'Stack', {
    env: { account: 'test-account', region: 'ap-southeast-2' },
  });
  const fn = new Function(stack, 'Fn', {
    runtime: Runtime.NODEJS_24_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = () => {}'),
  });
  // The variables of the function under test, as synthesised.
  const variables = (): Record<string, unknown> => {
    const functions = Template.fromStack(stack).findResources(
      'AWS::Lambda::Function',
    );
    return functions[stack.getLogicalId(fn.node.defaultChild as any)].Properties
      .Environment.Variables;
  };
  return { stack, fn, variables };
};

// Synthesizing a stack can pass Vitest's 5s default when CI runs every
// project's tests in parallel.
describe('bindSettings', { timeout: 30_000 }, () => {
  it('CoreTable gives DISCAVA_DYNAMODB_CORE_TABLE_TABLE_NAME', () => {
    const { stack, fn, variables } = setup();
    new CoreTable(stack, 'Table').bindSettings(fn);
    expect(Object.keys(variables())).toContain(
      'DISCAVA_DYNAMODB_CORE_TABLE_TABLE_NAME',
    );
  });

  it('LessonMediaBucket gives one variable per published field', () => {
    const { stack, fn, variables } = setup();
    new LessonMediaBucket(stack, 'Media', { enableWaf: false }).bindSettings(
      fn,
    );
    for (const field of [
      'BUCKET_NAME',
      'CLOUD_FRONT_DOMAIN_NAME',
      'CLOUD_FRONT_KEY_PAIR_ID',
      'CLOUD_FRONT_PRIVATE_KEY_SECRET_ARN',
    ]) {
      expect(Object.keys(variables())).toContain(
        `DISCAVA_S3_LESSON_MEDIA_BUCKET_${field}`,
      );
    }
  });

  it('LessonMediaUploadBucket gives DISCAVA_S3_LESSON_MEDIA_UPLOAD_BUCKET_BUCKET_NAME', () => {
    const { stack, fn, variables } = setup();
    new LessonMediaUploadBucket(stack, 'Upload').bindSettings(fn);
    expect(Object.keys(variables())).toContain(
      'DISCAVA_S3_LESSON_MEDIA_UPLOAD_BUCKET_BUCKET_NAME',
    );
  });

  it('PublicMediaBucket gives its variables and exposes its base URL', () => {
    const { stack, fn, variables } = setup();
    const bucket = new PublicMediaBucket(stack, 'Public', { enableWaf: false });
    bucket.bindSettings(fn);
    expect(Object.keys(variables())).toEqual(
      expect.arrayContaining([
        'DISCAVA_S3_PUBLIC_MEDIA_BUCKET_BUCKET_NAME',
        'DISCAVA_S3_PUBLIC_MEDIA_BUCKET_CLOUD_FRONT_DOMAIN_NAME',
      ]),
    );
    expect(JSON.stringify(stack.resolve(bucket.baseUrl))).toContain('https://');
  });

  it('OpenSearchCollection gives DISCAVA_OPENSEARCH_SEARCH_ENDPOINT', () => {
    const { stack, fn, variables } = setup();
    new TestCollection(stack, 'Collection', {
      collectionName: 'discava-test',
      runtimeConfigKey: 'Search',
      indices: [],
      manifestHash: 'hash',
      indexSyncHandlerCode: Code.fromInline('exports.handler = () => {}'),
    }).bindSettings(fn);
    expect(Object.keys(variables())).toContain(
      'DISCAVA_OPENSEARCH_SEARCH_ENDPOINT',
    );
  });

  it('VideoTranscodePipeline gives its role and job template variables', () => {
    const { stack, fn, variables } = setup();
    new VideoTranscodePipeline(stack, 'Pipeline', {
      uploadBucket: new LessonMediaUploadBucket(stack, 'Upload'),
      mediaBucket: new LessonMediaBucket(stack, 'Media', { enableWaf: false }),
    }).bindSettings(fn);
    expect(Object.keys(variables())).toEqual(
      expect.arrayContaining([
        'DISCAVA_MEDIA_CONVERT_VIDEO_TRANSCODE_PIPELINE_ROLE_ARN',
        'DISCAVA_MEDIA_CONVERT_VIDEO_TRANSCODE_PIPELINE_JOB_TEMPLATE_ARN',
      ]),
    );
  });
});
