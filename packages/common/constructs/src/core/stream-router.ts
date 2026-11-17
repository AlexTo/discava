/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Duration, Stack } from 'aws-cdk-lib';
import {
  Alarm,
  ComparisonOperator,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IKey, Key } from 'aws-cdk-lib/aws-kms';
import { Function, StartingPosition } from 'aws-cdk-lib/aws-lambda';
import {
  DynamoEventSource,
  SqsDlq,
  SqsEventSource,
} from 'aws-cdk-lib/aws-lambda-event-sources';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { suppressRules } from './checkov.js';

// checkov's CKV_AWS_27 only recognises a KMS key, not SQS-managed SSE, which
// encrypts the queue just the same (as media-pipeline-stack.ts's queue).
export const suppressSqsManagedEncryption = (queue: Queue) =>
  suppressRules(
    queue,
    ['CKV_AWS_27'],
    'Encrypted with SQS-managed SSE, which this check does not recognise',
  );

/**
 * What the construct reads of a stream feature's registration (core-table's
 * `StreamFeature`, which satisfies it): the filters stay with the router's
 * code, so the infrastructure only needs the queue's settings.
 */
export interface StreamRouterFeature {
  /** Unique, kebab-case. Names the feature's resources. */
  readonly name: string;
  readonly batch: {
    readonly maxRecords: number;
    readonly windowSeconds: number;
  };
  /** Receives before a message goes to the feature's failure queue. */
  readonly maxReceiveCount: number;
  /** Optional cap on concurrent handler runs (at least 2). */
  readonly maxConcurrency?: number;
}

export interface StreamRouterProps {
  /** The table whose stream the router is the only reader of. */
  readonly table: ITable;
  /** The router's Lambda, which `FEATURE_QUEUE_URLS` and `FAILURE_QUEUE_URL` are added to. */
  readonly router: Function;
  /** The registered features. One queue, failure queue, alarm and mapping each. */
  readonly features: readonly StreamRouterFeature[];
  /** Each feature's handler Lambda, by the feature's name. */
  readonly handlers: Readonly<Record<string, Function>>;
  /**
   * Whether to encrypt the queues with a customer-managed KMS key. When
   * `false` they use SQS-managed encryption.
   *
   * @default true
   */
  readonly enableKmsEncryption?: boolean;
  /**
   * KMS key used to encrypt the queues. Only used when `enableKmsEncryption`
   * is `true`. When not provided, a new key is created.
   */
  readonly encryptionKey?: IKey;
  /**
   * Whether the automatically created KMS key has rotation enabled. Only
   * applies when `enableKmsEncryption` is `true` and no `encryptionKey` is
   * supplied.
   *
   * @default true
   */
  readonly enableKeyRotation?: boolean;
}

// AWS's guidance for an SQS-triggered Lambda: a visibility timeout of at
// least six times the function's timeout.
const VISIBILITY_TIMEOUT_FACTOR = 6;
const FAILURE_RETENTION = Duration.days(14);

/**
 * The one reader of the core table's stream, and what it feeds: the router
 * Lambda sends each change to the queue of every feature that wants it, and
 * each feature's handler reads its own queue. A feature adds a registration
 * and a handler; its queue, failure queue, alarm and mapping come from here.
 *
 * Failures: a message a handler can't process moves to the feature's failure
 * queue after the registration's `maxReceiveCount` receives, and a record the
 * router can't send is described in `StreamRouterFailures`. Each failure
 * queue has an alarm on its depth with no action attached, so operators see
 * it and redrive with the queue service's own redrive.
 */
export class StreamRouter extends Construct {
  /** The queue each feature's messages wait in, by feature name. */
  public readonly queues: Readonly<Record<string, Queue>> = {};
  /** Each feature's failure queue, by feature name. */
  public readonly failureQueues: Readonly<Record<string, Queue>> = {};
  /** Where the router describes records it could not send. */
  public readonly routerFailures: Queue;
  public readonly encryptionKey?: IKey;

  constructor(
    scope: Construct,
    id: string,
    {
      table,
      router,
      features,
      handlers,
      enableKmsEncryption = true,
      encryptionKey,
      enableKeyRotation = true,
    }: StreamRouterProps,
  ) {
    super(scope, id);

    this.encryptionKey = enableKmsEncryption
      ? (encryptionKey ?? new Key(this, 'EncryptionKey', { enableKeyRotation }))
      : undefined;

    this.routerFailures = this.failureQueue('StreamRouterFailures');
    // The queue a stream mapping's `onFailure` writes to holds where in the
    // stream a batch failed (shard and sequence numbers), and the router
    // writes its own descriptions of unsendable records here too.
    this.routerFailures.grantSendMessages(router);
    this.alarmOn('StreamRouterFailuresAlarm', this.routerFailures);

    const queueUrls: Record<string, string> = {};
    for (const feature of features) {
      const handler = handlers[feature.name];
      if (!handler) {
        throw new Error(
          `No handler given for stream feature '${feature.name}'`,
        );
      }
      const pascal = feature.name
        .split('-')
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join('');

      const failures = this.failureQueue(`${pascal}Failures`);
      const queue = new Queue(this, `${pascal}Queue`, {
        ...this.encryption(),
        enforceSSL: true,
        visibilityTimeout: Duration.seconds(
          (handler.timeout ?? Duration.seconds(3)).toSeconds() *
            VISIBILITY_TIMEOUT_FACTOR,
        ),
        deadLetterQueue: {
          queue: failures,
          maxReceiveCount: feature.maxReceiveCount,
        },
      });
      if (!this.encryptionKey) suppressSqsManagedEncryption(queue);

      this.alarmOn(`${pascal}FailuresAlarm`, failures);
      queue.grantSendMessages(router);
      handler.addEventSource(
        new SqsEventSource(queue, {
          batchSize: feature.batch.maxRecords,
          maxBatchingWindow: Duration.seconds(feature.batch.windowSeconds),
          maxConcurrency: feature.maxConcurrency,
        }),
      );

      (this.queues as Record<string, Queue>)[feature.name] = queue;
      (this.failureQueues as Record<string, Queue>)[feature.name] = failures;
      queueUrls[feature.name] = queue.queueUrl;
    }

    router.addEnvironment(
      'FEATURE_QUEUE_URLS',
      Stack.of(this).toJsonString(queueUrls),
    );
    router.addEnvironment('FAILURE_QUEUE_URL', this.routerFailures.queueUrl);

    // The table's only stream mapping: adding a feature adds a queue, never a
    // second reader on the stream.
    router.addEventSource(
      new DynamoEventSource(table, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 100,
        // The router only routes: the window that gathers a burst for one
        // handler run is on each feature's queue.
        maxBatchingWindow: Duration.seconds(1),
        retryAttempts: 5,
        bisectBatchOnError: true,
        reportBatchItemFailures: true,
        onFailure: new SqsDlq(this.routerFailures),
      }),
    );
  }

  private encryption() {
    return this.encryptionKey
      ? {
          encryption: QueueEncryption.KMS,
          encryptionMasterKey: this.encryptionKey,
        }
      : { encryption: QueueEncryption.SQS_MANAGED };
  }

  private failureQueue(id: string) {
    const queue = new Queue(this, id, {
      ...this.encryption(),
      enforceSSL: true,
      retentionPeriod: FAILURE_RETENTION,
    });
    if (!this.encryptionKey) suppressSqsManagedEncryption(queue);
    return queue;
  }

  // No action is attached: the alarm shows in CloudWatch for an operator.
  private alarmOn(id: string, failures: Queue) {
    return new Alarm(this, id, {
      metric: failures.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(1),
        statistic: 'Maximum',
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
  }
}
