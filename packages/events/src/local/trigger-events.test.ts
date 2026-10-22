/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { EventBridgeSchema } from '@aws-lambda-powertools/parser/schemas';
import { describe, expect, it, vi } from 'vitest';
import { transcodeComplete } from '../media/transcode-complete.js';
import {
  preTokenGenerationEvent,
  transcodeCompletionEvent,
} from './trigger-events.js';

const applyTranscodeOutcome = vi.hoisted(() => vi.fn());
vi.mock('../media/transcode-outcome.js', () => ({ applyTranscodeOutcome }));

const USER_METADATA = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'item-1',
  rawObjectKey: 'courses/course-1/raw/upload-1.mp4',
  submissionNonce: 'nonce-1',
};

describe('transcodeCompletionEvent', () => {
  it('is accepted by transcode-complete as MediaConvert’s event would be', async () => {
    const event = EventBridgeSchema.parse(
      transcodeCompletionEvent('local-job-1', 'COMPLETE', USER_METADATA),
    );

    await transcodeComplete(event);

    expect(applyTranscodeOutcome).toHaveBeenCalledWith(expect.anything(), {
      jobId: 'local-job-1',
      status: 'COMPLETE',
      ...USER_METADATA,
    });
  });
});

describe('preTokenGenerationEvent', () => {
  it('is what Cognito sends the trigger on a sign-in', () => {
    const userAttributes = { sub: 'user-1', email: 'erin@example.com' };

    expect(
      preTokenGenerationEvent({ userName: 'erin', userAttributes }),
    ).toMatchObject({
      version: '1',
      triggerSource: 'TokenGeneration_HostedAuth',
      userName: 'erin',
      request: { userAttributes },
    });
  });
});
