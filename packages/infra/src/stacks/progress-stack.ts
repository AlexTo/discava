/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  CoreTable,
  EventsProgressRecalculation,
  RuntimeConfig,
} from '@discava/common-constructs';
import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import {
  FilterCriteria,
  FilterRule,
  StartingPosition,
} from 'aws-cdk-lib/aws-lambda';
import {
  DynamoEventSource,
  SqsDlq,
} from 'aws-cdk-lib/aws-lambda-event-sources';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface ProgressStackProps extends StackProps {
  readonly coreTable: CoreTable;
}

// The progress recalculation: the single writer of lesson progress and of the
// enrolment's progressPercent, status and completedAt, run from the core
// table's stream.
export class ProgressStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    { coreTable, ...props }: ProgressStackProps,
  ) {
    super(scope, id, props);

    const recalculation = new EventsProgressRecalculation(
      this,
      'ProgressRecalculation',
    );
    const runtimeConfig = RuntimeConfig.ensure(this);
    recalculation.addEnvironment(
      'RUNTIME_CONFIG_APP_ID',
      runtimeConfig.appConfigApplicationId,
    );
    runtimeConfig.grantReadAppConfig(recalculation);
    coreTable.grantReadWriteData(recalculation);

    // A batch still failing after its retries, split down to the records
    // that fail, lands here instead of blocking the stream. Every run
    // recomputes from scratch, so the next change for the same students
    // also repairs what a failed batch missed.
    // Its messages say where in the stream a batch failed (shard and
    // sequence numbers), not what the records held, so the AWS managed key
    // is enough.
    const failures = new Queue(this, 'ProgressRecalculationFailures', {
      encryption: QueueEncryption.KMS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });

    // Only the records that can change progress invoke the Lambda. ElectroDB
    // stores each record's entity name in `__edb_e__`. A filter can't compare
    // the old and new images, so for curriculum records the Lambda itself
    // checks that visibility or archivedAt changed. Its own writes (progress,
    // enrolment) match none of these, so it never triggers itself.
    const entity = (image: 'NewImage' | 'OldImage', names: string[]) => ({
      dynamodb: { [image]: { __edb_e__: { S: FilterRule.or(...names) } } },
    });
    const curriculum = ['module', 'lesson', 'contentItem'];
    recalculation.addEventSource(
      new DynamoEventSource(coreTable.table, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 100,
        // Gathers a burst of edits (an instructor publishing a module, say)
        // into one batch, so each course is recalculated once for it.
        maxBatchingWindow: Duration.seconds(5),
        retryAttempts: 5,
        bisectBatchOnError: true,
        onFailure: new SqsDlq(failures),
        filters: [
          FilterCriteria.filter({
            eventName: FilterRule.isEqual('INSERT'),
            ...entity('NewImage', ['itemCompletion']),
          }),
          FilterCriteria.filter({
            eventName: FilterRule.isEqual('MODIFY'),
            ...entity('NewImage', curriculum),
          }),
          FilterCriteria.filter({
            eventName: FilterRule.isEqual('REMOVE'),
            ...entity('OldImage', curriculum),
          }),
        ],
      }),
    );
  }
}
