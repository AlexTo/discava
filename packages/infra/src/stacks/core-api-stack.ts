/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AdminPortal,
  CoreApi,
  CoreTable,
  EventsProgressRecalculation,
  EventsSearchIndexer,
  InstructorPortal,
  LessonMediaBucket,
  RuntimeConfig,
  SearchCollection,
  StudentPortal,
  suppressRules,
  UserIdentity,
} from '@discava/common-constructs';
import type { CoreApiComponentConfig } from '@discava/common-infra-config';
import {
  PROGRESS_STREAM_FILTERS,
  SEARCH_STREAM_FILTERS,
} from '@discava/core-table';
import {
  CfnResource,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
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
import { apiLimits, publicThrottle } from './api-limits.js';

type CoreApiIntegrations = ReturnType<
  ReturnType<typeof CoreApi.defaultIntegrations>['build']
>;

export interface CoreApiStackProps extends StackProps {
  /** Settings for the core API construct. @default all enabled */
  readonly coreApi?: CoreApiComponentConfig;
  readonly identity: UserIdentity;
  readonly coreTable: CoreTable;
  /** Lesson videos, whose signing key contentItem.videoUrl signs cookies with. */
  readonly lessonMediaBucket: LessonMediaBucket;
  /** Every portal calls core-api, so all three are allowed CORS origins. */
  readonly portals: [StudentPortal, InstructorPortal, AdminPortal];
}

/**
 * The tRPC API any authenticated user can call, plus the progress
 * recalculation that turns the item completions it records into lesson and
 * enrolment progress.
 */
export class CoreApiStack extends Stack {
  public readonly coreApi: CoreApi<CoreApiIntegrations>;
  /** The OpenSearch Serverless collection backing cross-content-type search. */
  public readonly search: SearchCollection;

  constructor(
    scope: Construct,
    id: string,
    {
      coreApi: coreApiConfig,
      identity,
      coreTable,
      lessonMediaBucket,
      portals,
      ...props
    }: CoreApiStackProps,
  ) {
    super(scope, id, props);

    const coreApiKmsEnabled = coreApiConfig?.enableKmsEncryption ?? true;
    const limits = apiLimits(coreApiConfig);
    const integrations = CoreApi.defaultIntegrations(
      this,
      limits.functionOptions,
    ).build();
    const coreApiCertificate = coreApiConfig?.certificateArn
      ? Certificate.fromCertificateArn(
          this,
          'CoreApiCertificate',
          coreApiConfig.certificateArn,
        )
      : undefined;

    this.coreApi = new CoreApi(this, 'CoreApi', {
      integrations,
      identity,
      enableWaf: coreApiConfig?.enableWaf ?? true,
      throttle: limits.throttle,
      publicThrottle: publicThrottle(coreApiConfig),
      enableTracing: limits.enableTracing,
      enableKmsEncryption: coreApiKmsEnabled,
      enableKeyRotation: coreApiConfig?.enableKeyRotation ?? true,
      removalPolicy:
        (coreApiConfig?.retainOnDelete ?? true)
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
      domainName: coreApiConfig?.domainName,
      certificate: coreApiCertificate,
    });
    if (!coreApiKmsEnabled) {
      suppressRules(
        this,
        ['CKV_AWS_158'],
        'KMS encryption disabled for this stage',
        (c) =>
          CfnResource.isCfnResource(c) &&
          c.cfnResourceType === 'AWS::Logs::LogGroup' &&
          c.node.path.includes('/CoreApi/AccessLogs'),
      );
    }

    Object.values(integrations).forEach(({ handler }) =>
      coreTable.grantReadWriteData(handler),
    );
    for (const op of ['contentItem.videoUrl', 'contentItem.fileUrl'] as const) {
      lessonMediaBucket.grantReadSigningKey(
        this.privilegedHandler(integrations, op),
      );
    }

    // The OpenSearch Serverless collection (issue #53). The search procedure
    // is served by its own dedicated function, which is the only core-api
    // function granted the collection's read access.
    this.search = new SearchCollection(this, 'Search');
    this.search.grantReadOnly(this.privilegedHandler(integrations, 'search'));

    this.coreApi.restrictCorsTo(
      ...portals,
      'http://localhost:4200',
      'http://localhost:4300',
      'http://localhost:4201',
      'http://localhost:4301',
      'http://localhost:4202',
      'http://localhost:4302',
    );

    this.createProgressRecalculationLambda(coreTable);
    this.createSearchIndexerLambda(coreTable);
  }

  // Every grant beyond the baseline (table + AppConfig) goes through this,
  // so a procedure missing from CORE_API_DEDICATED_FUNCTIONS fails synth
  // instead of silently handing its permissions to the shared router function
  // that serves every other core-api procedure.
  private privilegedHandler(
    integrations: CoreApiIntegrations,
    op: keyof CoreApiIntegrations,
  ) {
    if (!CoreApi.hasDedicatedFunction(op)) {
      throw new Error(
        `core-api operation '${op}' is served by the shared router; add it to CORE_API_DEDICATED_FUNCTIONS before granting it extra permissions`,
      );
    }
    return integrations[op].handler;
  }

  // The single writer of lesson progress and of the enrolment's
  // progressPercent, status and completedAt, run from the core table's
  // stream.
  private createProgressRecalculationLambda(coreTable: CoreTable) {
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

    // Only the records that can change progress invoke the Lambda (see
    // PROGRESS_STREAM_FILTERS, which local dev's event runner applies too).
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
        filters: PROGRESS_STREAM_FILTERS.map(({ eventName, image, entities }) =>
          FilterCriteria.filter({
            eventName: FilterRule.isEqual(eventName),
            dynamodb: {
              [image]: { __edb_e__: { S: FilterRule.or(...entities) } },
            },
          }),
        ),
      }),
    );

    return recalculation;
  }

  // Keeps the search indices in step with the core table, from the same
  // stream, filtered by SEARCH_STREAM_FILTERS (which local dev's event runner
  // applies too). It reindexes each affected course and user from the table's
  // current state, so it only reads the table.
  private createSearchIndexerLambda(coreTable: CoreTable) {
    const indexer = new EventsSearchIndexer(this, 'SearchIndexer');
    const runtimeConfig = RuntimeConfig.ensure(this);
    indexer.addEnvironment(
      'RUNTIME_CONFIG_APP_ID',
      runtimeConfig.appConfigApplicationId,
    );
    runtimeConfig.grantReadAppConfig(indexer);
    coreTable.grantReadData(indexer);

    // The indexer writes the search indices, so it is the collection's
    // read-write principal (alongside the index-sync handler).
    this.search.grantReadWrite(indexer);

    // A batch that still fails after its retries, split down to the records
    // that fail, lands here instead of blocking the stream. The indexer
    // reindexes from the table's current state, so the next change for the
    // same course or user repairs what a failed batch missed.
    const failures = new Queue(this, 'SearchIndexerFailures', {
      encryption: QueueEncryption.KMS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });

    indexer.addEventSource(
      new DynamoEventSource(coreTable.table, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 100,
        maxBatchingWindow: Duration.seconds(5),
        retryAttempts: 5,
        bisectBatchOnError: true,
        onFailure: new SqsDlq(failures),
        filters: SEARCH_STREAM_FILTERS.map(({ eventName, image, entities }) =>
          FilterCriteria.filter({
            eventName: FilterRule.isEqual(eventName),
            dynamodb: {
              [image]: { __edb_e__: { S: FilterRule.or(...entities) } },
            },
          }),
        ),
      }),
    );

    return indexer;
  }
}
