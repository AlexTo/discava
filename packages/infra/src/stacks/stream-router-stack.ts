/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  CoreTable,
  EventsAnalyticsUpdate,
  EventsProgressRecalculation,
  EventsSearchIndexing,
  EventsStreamRouter,
  RuntimeConfig,
  SearchCollection,
  StreamRouter,
} from '@discava/common-constructs';
import type { StreamRouterComponentConfig } from '@discava/common-infra-config';
import { STREAM_FEATURES } from '@discava/core-table';
import { Stack, StackProps } from 'aws-cdk-lib';
import type { Function } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface StreamRouterStackProps extends StackProps {
  /** Settings for the stream router's queues. @default all enabled */
  readonly streamRouter?: StreamRouterComponentConfig;
  readonly coreTable: CoreTable;
  readonly searchCollection: SearchCollection;
}

/**
 * The only reader of the core table's stream and everything it feeds: the
 * router Lambda, one queue (with a failure queue and an alarm) per registered
 * feature in core-table's `STREAM_FEATURES`, and the feature handlers those
 * queues invoke (progress recalculation, search indexing and analytics). Kept apart from
 * CoreApi so a feature's queues and handler don't count against that stack's
 * resource limit, and depends on Data only.
 */
export class StreamRouterStack extends Stack {
  public readonly streamRouter: StreamRouter;

  constructor(
    scope: Construct,
    id: string,
    {
      streamRouter: streamRouterConfig,
      coreTable,
      searchCollection,
      ...props
    }: StreamRouterStackProps,
  ) {
    super(scope, id, props);

    const router = new EventsStreamRouter(this, 'StreamRouterFunction');
    const handlers = {
      'progress-recalculation':
        this.createProgressRecalculationLambda(coreTable),
      'search-indexing': this.createSearchIndexingLambda(
        coreTable,
        searchCollection,
      ),
      'analytics-update': this.createAnalyticsUpdateLambda(coreTable),
    };

    this.streamRouter = new StreamRouter(this, 'StreamRouter', {
      table: coreTable.table,
      router,
      features: STREAM_FEATURES,
      handlers,
      enableKmsEncryption: streamRouterConfig?.enableKmsEncryption ?? true,
      enableKeyRotation: streamRouterConfig?.enableKeyRotation ?? true,
    });
  }

  // How a handler reads AppConfig: the application lives in Data, which this
  // stack depends on, so the id is a plain cross-stack reference. The
  // configuration's content is in RuntimeConfig, which deploys last and
  // depends on every stack that grants here, so no cycle appears.
  private grantAppConfig(handler: Function) {
    const runtimeConfig = RuntimeConfig.ensure(this);
    handler.addEnvironment(
      'RUNTIME_CONFIG_APP_ID',
      runtimeConfig.appConfigApplicationId,
    );
    runtimeConfig.grantReadAppConfig(handler);
  }

  // The single writer of lesson progress and of the enrolment's
  // progressPercent, status and completedAt, run from its feature's queue.
  private createProgressRecalculationLambda(coreTable: CoreTable) {
    const recalculation = new EventsProgressRecalculation(
      this,
      'ProgressRecalculation',
    );
    this.grantAppConfig(recalculation);
    coreTable.grantReadWriteData(recalculation);
    return recalculation;
  }

  // The single writer of the search collection's documents, run from its
  // feature's queue. The messages only say which courses changed: it reads
  // each one from the table to see what to index, so it can read the table
  // but never write it.
  private createSearchIndexingLambda(
    coreTable: CoreTable,
    searchCollection: SearchCollection,
  ) {
    const indexing = new EventsSearchIndexing(this, 'SearchIndexing');
    this.grantAppConfig(indexing);
    coreTable.grantReadData(indexing);
    searchCollection.grantWrite(indexing.role!);
    return indexing;
  }

  // The single writer of the instructor dashboard's analytics aggregates, run
  // from its feature's queue. It reads no other record: each change carries
  // what it adds, so it only writes the table.
  private createAnalyticsUpdateLambda(coreTable: CoreTable) {
    const analytics = new EventsAnalyticsUpdate(this, 'AnalyticsUpdate');
    this.grantAppConfig(analytics);
    coreTable.grantReadWriteData(analytics);
    return analytics;
  }
}
