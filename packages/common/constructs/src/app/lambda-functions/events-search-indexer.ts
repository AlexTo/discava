/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Duration } from 'aws-cdk-lib';
import {
  Architecture,
  Code,
  Function,
  Runtime,
  Tracing,
} from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as url from 'url';

/**
 * Keeps the search indices in step with the core table, run from the table's
 * stream (wired by the infra stack, filtered by SEARCH_STREAM_FILTERS). It
 * reindexes each affected course and user from the table's current state, so
 * it only reads the table. The collection endpoint comes from the OpenSearch
 * runtime config the infra stack wires up (RUNTIME_CONFIG_APP_ID).
 */
export class EventsSearchIndexer extends Function {
  constructor(scope: Construct, id: string) {
    super(scope, id, {
      // A burst of edits (an instructor publishing a module) reindexes a
      // whole course; keep the ceiling high enough for a large course.
      timeout: Duration.minutes(5),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      code: Code.fromAsset(
        url.fileURLToPath(
          new URL(
            '../../../../../../dist/packages/events/bundle/lambda/search-indexer',
            import.meta.url,
          ),
        ),
      ),
      tracing: Tracing.ACTIVE,
      environment: {},
    });
  }
}
