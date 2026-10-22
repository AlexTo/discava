/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AddressInfo } from 'node:net';
import { EventBridgeSchema } from '@aws-lambda-powertools/parser/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { transcodeComplete } from '../media/transcode-complete.js';
import {
  preTokenGenerationEvent,
  startEventRunnerServer,
  transcodeCompletionEvent,
} from './endpoints.js';

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

describe('startEventRunnerServer', () => {
  let server: ReturnType<typeof startEventRunnerServer> | undefined;
  afterEach(() => {
    server?.close();
  });

  const start = () => {
    const handlers = {
      submit: vi.fn(() => 'local-job-1'),
      cancel: vi.fn((jobId: string) => jobId === 'local-job-1'),
      schedule: vi.fn(),
      signIn: vi.fn(async () => {}),
    };
    server = startEventRunnerServer({ port: 0, ...handlers, log: () => {} });
    const url = (path: string) =>
      `http://localhost:${(server!.address() as AddressInfo).port}${path}`;
    return { handlers, url };
  };

  const json = (body: unknown) => ({
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  it('queues a transcode job, answering with its ID as CreateJob does', async () => {
    const { handlers, url } = start();
    await new Promise((resolve) => server!.once('listening', resolve));
    const job = {
      inputKey: 'raw.mp4',
      outputPrefix: 'out/nonce-1/',
      userMetadata: USER_METADATA,
    };

    const response = await fetch(url('/transcode-jobs'), {
      method: 'POST',
      ...json(job),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ jobId: 'local-job-1' });
    expect(handlers.submit).toHaveBeenCalledWith(job);
  });

  it('refuses a job without somewhere to put its output', async () => {
    const { url } = start();
    await new Promise((resolve) => server!.once('listening', resolve));

    const response = await fetch(url('/transcode-jobs'), {
      method: 'POST',
      ...json({ inputKey: 'raw.mp4', outputPrefix: 'no-slash' }),
    });

    expect(response.status).toBe(400);
  });

  it('cancels a job, or says there’s no such job', async () => {
    const { url } = start();
    await new Promise((resolve) => server!.once('listening', resolve));

    expect(
      (await fetch(url('/transcode-jobs/local-job-1'), { method: 'DELETE' }))
        .status,
    ).toBe(204);
    expect(
      (await fetch(url('/transcode-jobs/local-job-2'), { method: 'DELETE' }))
        .status,
    ).toBe(404);
  });

  it('schedules a transcode cleanup with Scheduler’s payload', async () => {
    const { handlers, url } = start();
    await new Promise((resolve) => server!.once('listening', resolve));
    const payload = { contentItemId: 'item-1', submissionNonce: 'nonce-1' };

    const response = await fetch(url('/schedules/transcode-cleanup'), {
      method: 'POST',
      ...json({ payload }),
    });

    expect(response.status).toBe(202);
    expect(handlers.schedule).toHaveBeenCalledWith({ payload });
  });

  it('runs the pre token generation trigger for a sign-in, answering once it has', async () => {
    const { handlers, url } = start();
    await new Promise((resolve) => server!.once('listening', resolve));
    const signIn = {
      userName: 'erin',
      userAttributes: { sub: 'user-1', given_name: 'Erin' },
    };

    const response = await fetch(url('/triggers/pre-token-generation'), {
      method: 'POST',
      ...json(signIn),
    });

    expect(response.status).toBe(204);
    expect(handlers.signIn).toHaveBeenCalledWith(signIn);
  });

  it('refuses a sign-in without the user’s sub', async () => {
    const { handlers, url } = start();
    await new Promise((resolve) => server!.once('listening', resolve));

    const response = await fetch(url('/triggers/pre-token-generation'), {
      method: 'POST',
      ...json({ userName: 'erin', userAttributes: {} }),
    });

    expect(response.status).toBe(400);
    expect(handlers.signIn).not.toHaveBeenCalled();
  });
});
