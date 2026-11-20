/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Duration } from 'aws-cdk-lib';
import { Code, Function, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as url from 'url';

export class EventsCertificateReminder extends Function {
  constructor(scope: Construct, id: string) {
    super(scope, id, {
      timeout: Duration.seconds(30),
      runtime: Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: Code.fromAsset(
        url.fileURLToPath(
          new URL(
            '../../../../../../dist/packages/events/bundle/lambda/certificate-reminder',
            import.meta.url,
          ),
        ),
      ),
      tracing: Tracing.ACTIVE,
      environment: {},
    });
  }
}
