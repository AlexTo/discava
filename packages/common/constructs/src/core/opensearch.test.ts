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

describe('OpenSearchCollection', () => {
  it('re-runs the index sync when the collection is replaced', () => {
    // CloudFormation only invokes the handler on a changed property, and the
    // manifest alone doesn't change when the collection is replaced.
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
        CollectionId: {
          'Fn::GetAtt': [Match.stringLikeRegexp('^CollectionTest'), 'Id'],
        },
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
