/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { Duration, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AttributeType, StreamViewType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { describe, expect, it } from 'vitest';
import { StreamRouter, type StreamRouterFeature } from './stream-router.js';

const FEATURES: StreamRouterFeature[] = [
  {
    name: 'progress-recalculation',
    batch: { maxRecords: 100, windowSeconds: 5 },
    maxReceiveCount: 5,
  },
  {
    name: 'search-indexing',
    batch: { maxRecords: 100, windowSeconds: 5 },
    maxReceiveCount: 5,
    maxConcurrency: 2,
  },
];

const lambda = (stack: Stack, id: string, timeout = Duration.minutes(2)) =>
  new Function(stack, id, {
    runtime: Runtime.NODEJS_24_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => {}'),
    timeout,
  });

const synth = (
  features: StreamRouterFeature[] = FEATURES,
  props: { enableKmsEncryption?: boolean } = {},
) => {
  const stack = new Stack();
  const table = new Table(stack, 'Table', {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
    stream: StreamViewType.NEW_AND_OLD_IMAGES,
  });
  const router = lambda(stack, 'Router', Duration.seconds(30));
  const handlers = Object.fromEntries(
    features.map((f) => [f.name, lambda(stack, `Handler-${f.name}`)]),
  );
  new StreamRouter(stack, 'StreamRouter', {
    table,
    router,
    features,
    handlers,
    ...props,
  });
  return Template.fromStack(stack);
};

const countOf = (template: Template, type: string) =>
  Object.keys(template.findResources(type)).length;

describe('StreamRouter', () => {
  it('gives the table stream exactly one event source mapping', () => {
    const template = synth();
    const mappings = template.findResources('AWS::Lambda::EventSourceMapping');
    const streamMappings = Object.values(mappings).filter(
      (m) => m.Properties.EventSourceArn?.['Fn::GetAtt']?.[1] === 'StreamArn',
    );
    expect(streamMappings).toHaveLength(1);
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      StartingPosition: 'LATEST',
      BatchSize: 100,
      MaximumBatchingWindowInSeconds: 1,
      MaximumRetryAttempts: 5,
      BisectBatchOnFunctionError: true,
      FunctionResponseTypes: ['ReportBatchItemFailures'],
      DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
    });
  });

  it('creates a queue, failure queue, alarm and mapping per feature, plus the router failures', () => {
    const template = synth();
    // Per feature: queue and failure queue; plus StreamRouterFailures.
    expect(countOf(template, 'AWS::SQS::Queue')).toBe(2 * 2 + 1);
    expect(countOf(template, 'AWS::CloudWatch::Alarm')).toBe(2 + 1);
    // One SQS mapping per feature, and the stream's.
    expect(countOf(template, 'AWS::Lambda::EventSourceMapping')).toBe(2 + 1);
  });

  it('sets each queue from the registration', () => {
    const template = synth();
    template.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 720,
      RedrivePolicy: {
        maxReceiveCount: 5,
        deadLetterTargetArn: Match.anyValue(),
      },
    });
    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 14 * 24 * 60 * 60,
    });
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      BatchSize: 100,
      MaximumBatchingWindowInSeconds: 5,
      ScalingConfig: { MaximumConcurrency: 2 },
    });
    template.hasResourceProperties('AWS::SQS::QueuePolicy', {
      PolicyDocument: {
        Statement: [
          Match.objectLike({
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ],
      },
    });
  });

  it('alarms on a failure queue having a message, with no action', () => {
    const template = synth();
    const alarms = Object.values(
      template.findResources('AWS::CloudWatch::Alarm'),
    );
    expect(alarms).toHaveLength(3);
    for (const { Properties } of alarms) {
      expect(Properties).toMatchObject({
        MetricName: 'ApproximateNumberOfMessagesVisible',
        ComparisonOperator: 'GreaterThanThreshold',
        Threshold: 0,
      });
      expect(Properties.AlarmActions).toBeUndefined();
    }
  });

  it('lets the router send to the queues and read the stream, and nothing else', () => {
    const template = synth();
    const policies = Object.entries(template.findResources('AWS::IAM::Policy'))
      .filter(([id]) => id.startsWith('RouterServiceRole'))
      .flatMap(([, p]) => p.Properties.PolicyDocument.Statement);
    const actions = policies.flatMap((s: { Action: string | string[] }) =>
      [s.Action].flat(),
    );
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action).toMatch(
        /^(sqs:(SendMessage|GetQueueAttributes|GetQueueUrl)|dynamodb:(DescribeStream|GetRecords|GetShardIterator|ListStreams)|kms:.*)$/,
      );
    }
    const sendTargets = policies
      .filter((s: { Action: string | string[] }) =>
        [s.Action].flat().includes('sqs:SendMessage'),
      )
      .flatMap((s: { Resource: unknown }) => [s.Resource].flat());
    // Two feature queues and the router failures.
    expect(sendTargets).toHaveLength(3);
  });

  it('uses one KMS key for every queue when encryption is on', () => {
    const template = synth();
    expect(countOf(template, 'AWS::KMS::Key')).toBe(1);
    const queues = Object.values(template.findResources('AWS::SQS::Queue'));
    for (const { Properties } of queues) {
      expect(Properties.KmsMasterKeyId).toBeDefined();
      expect(Properties.SqsManagedSseEnabled).toBeUndefined();
    }
  });

  it('has no key and uses SQS-managed encryption when it is off', () => {
    const template = synth(FEATURES, { enableKmsEncryption: false });
    expect(countOf(template, 'AWS::KMS::Key')).toBe(0);
    const queues = Object.values(template.findResources('AWS::SQS::Queue'));
    for (const { Properties, Metadata } of queues) {
      expect(Properties.KmsMasterKeyId).toBeUndefined();
      expect(Properties.SqsManagedSseEnabled).toBe(true);
      expect(Metadata.checkov.skip[0].id).toBe('CKV_AWS_27');
    }
  });

  it('adds one queue, failure queue, alarm and mapping for a third registration, and no stream reader', () => {
    const third: StreamRouterFeature = {
      name: 'notifications',
      batch: { maxRecords: 50, windowSeconds: 2 },
      maxReceiveCount: 5,
    };
    const template = synth([...FEATURES, third]);
    expect(countOf(template, 'AWS::SQS::Queue')).toBe(3 * 2 + 1);
    expect(countOf(template, 'AWS::CloudWatch::Alarm')).toBe(3 + 1);
    expect(countOf(template, 'AWS::Lambda::EventSourceMapping')).toBe(3 + 1);
    const streamMappings = Object.values(
      template.findResources('AWS::Lambda::EventSourceMapping'),
    ).filter(
      (m) => m.Properties.EventSourceArn?.['Fn::GetAtt']?.[1] === 'StreamArn',
    );
    expect(streamMappings).toHaveLength(1);
  });

  it('refuses a feature with no handler', () => {
    const stack = new Stack();
    const table = new Table(stack, 'Table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
    });
    expect(
      () =>
        new StreamRouter(stack, 'StreamRouter', {
          table,
          router: lambda(stack, 'Router'),
          features: FEATURES,
          handlers: {},
        }),
    ).toThrow(/No handler/);
  });
});
