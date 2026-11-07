/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
// (CDK resolves asset paths from import.meta.url, which jsdom doesn't provide.)
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Code } from 'aws-cdk-lib/aws-lambda';
import { describe, expect, it } from 'vitest';
import { OpenSearchCollection } from './opensearch.js';

class TestCollection extends OpenSearchCollection {}

const create = (collectionName: string) =>
  new TestCollection(new Stack(new App(), 'Stack'), 'Collection', {
    collectionName,
    runtimeConfigKey: 'Test',
    indices: [],
    manifestHash: 'hash',
    indexSyncHandlerCode: Code.fromInline('exports.handler = () => {}'),
  });

// Synthesizing a stack can pass Vitest's 5s default when CI runs every
// project's tests in parallel.
describe('OpenSearchCollection', { timeout: 30_000 }, () => {
  it('runs the index sync on every deploy, so a deleted index comes back', () => {
    // CloudFormation only invokes the handler on a changed property, and
    // neither the manifest nor the collection changes when an index is
    // deleted by hand or the collection is replaced (a new, empty one).
    const stack = new Stack(new App(), 'Stack');
    new TestCollection(stack, 'Collection', {
      collectionName: 'discava-test',
      runtimeConfigKey: 'Test',
      indices: [],
      manifestHash: 'hash',
      indexSyncHandlerCode: Code.fromInline('exports.handler = () => {}'),
    });

    Template.fromStack(stack).hasResourceProperties(
      'AWS::CloudFormation::CustomResource',
      {
        ManifestHash: 'hash',
        // A value that differs each synthesis, so every deploy sends an Update.
        SyncedAt: Match.stringLikeRegexp('^\\d{4}-\\d{2}-\\d{2}T'),
      },
    );
  });

  it('accepts a name whose every derived policy name fits in 32 characters', () => {
    // 21 characters: `-encryption` makes 32.
    expect(() => create('discava-development01')).not.toThrow();
  });

  it('rejects a name too long for its derived policy names', () => {
    expect(() => create('discava-development012')).toThrow(
      /Invalid OpenSearch collection name/,
    );
  });

  it('rejects a name OpenSearch Serverless does not allow', () => {
    for (const name of ['Discava', '1discava', 'discava_search', 'ds']) {
      expect(() => create(name)).toThrow(/Invalid OpenSearch collection name/);
    }
  });
});
