/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import middy from '@middy/core';
import type { Context, PostConfirmationTriggerEvent } from 'aws-lambda';

export type { Context };

process.env.POWERTOOLS_METRICS_NAMESPACE = 'PostConfirmation';
process.env.POWERTOOLS_SERVICE_NAME = 'PostConfirmation';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();
const cognito = new CognitoIdentityProviderClient();

const SIGN_UP_GROUPS = ['student', 'instructor'];

export const postConfirmation = async (
  event: PostConfirmationTriggerEvent,
): Promise<PostConfirmationTriggerEvent> => {
  logger.info('Received event', { event });

  // Also fires as PostConfirmation_ConfirmForgotPassword, which should not
  // re-run group assignment
  if (event.triggerSource === 'PostConfirmation_ConfirmSignUp') {
    await Promise.all(
      SIGN_UP_GROUPS.map((groupName) =>
        cognito.send(
          new AdminAddUserToGroupCommand({
            UserPoolId: event.userPoolId,
            Username: event.userName,
            GroupName: groupName,
          }),
        ),
      ),
    );
  }

  return event;
};

export const handler = middy<PostConfirmationTriggerEvent>()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .handler(postConfirmation);
