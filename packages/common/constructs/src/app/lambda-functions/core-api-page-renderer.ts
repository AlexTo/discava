/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Duration } from 'aws-cdk-lib';
import {
  Architecture,
  Code,
  Function,
  FunctionProps,
  Runtime,
  Tracing,
} from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as url from 'url';

/**
 * Core API's page renderer: the Lambda behind the student portal's landing
 * pages, instructor profiles, site map and robots.txt. Its Function URL and
 * CloudFront wiring are in `StudentPortal`.
 */
export class CoreApiPageRenderer extends Function {
  constructor(
    scope: Construct,
    id: string,
    props?: Pick<FunctionProps, 'environment' | 'reservedConcurrentExecutions'>,
  ) {
    super(scope, id, {
      timeout: Duration.seconds(10),
      memorySize: 512,
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      code: Code.fromAsset(
        url.fileURLToPath(
          new URL(
            '../../../../../../dist/packages/apis/core-api/page-renderer-bundle',
            import.meta.url,
          ),
        ),
      ),
      tracing: Tracing.ACTIVE,
      ...props,
    });
  }
}
