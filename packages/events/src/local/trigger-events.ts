/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import type {
  LocalSignInRequest,
  LocalTranscodeJobRequest,
} from '@discava/common-server-utils/local-dev';
import type { PreTokenGenerationTriggerEvent } from 'aws-lambda';

/**
 * The EventBridge event MediaConvert emits when a job finishes, as the
 * TranscodeComplete rule delivers it to transcode-complete.
 */
export const transcodeCompletionEvent = (
  jobId: string,
  status: 'COMPLETE' | 'ERROR',
  userMetadata: LocalTranscodeJobRequest['userMetadata'],
) => ({
  version: '0',
  id: randomUUID(),
  'detail-type': 'MediaConvert Job State Change',
  source: 'aws.mediaconvert',
  account: '000000000000',
  time: new Date().toISOString(),
  region: 'local',
  resources: [`arn:aws:mediaconvert:local:000000000000:jobs/${jobId}`],
  detail: { jobId, status, userMetadata },
});

/**
 * Cognito's pre token generation event (version 1), built from the local
 * OIDC sign-in request.
 */
export const preTokenGenerationEvent = ({
  userName,
  userAttributes,
}: LocalSignInRequest): PreTokenGenerationTriggerEvent => ({
  version: '1',
  triggerSource: 'TokenGeneration_HostedAuth',
  region: 'local',
  userPoolId: 'local',
  userName,
  callerContext: { awsSdkVersion: 'local', clientId: 'local' },
  request: { userAttributes, groupConfiguration: { groupsToOverride: [] } },
  response: { claimsOverrideDetails: {} },
});
