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

export class EventsSearchIndexing extends Function {
  constructor(scope: Construct, id: string) {
    super(scope, id, {
      timeout: Duration.minutes(2),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      code: Code.fromAsset(
        url.fileURLToPath(
          new URL(
            '../../../../../../dist/packages/events/bundle/lambda/search-indexing',
            import.meta.url,
          ),
        ),
      ),
      tracing: Tracing.ACTIVE,
      environment: {},
    });
  }
}
