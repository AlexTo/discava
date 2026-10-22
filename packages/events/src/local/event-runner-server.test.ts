/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startEventRunnerServer } from './event-runner-server.js';

const USER_METADATA = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'item-1',
  rawObjectKey: 'courses/course-1/raw/upload-1.mp4',
  submissionNonce: 'nonce-1',
};

describe('startEventRunnerServer', () => {
  let server: ReturnType<typeof startEventRunnerServer> | undefined;
  afterEach(() => {
    server?.close();
  });

  const start = () => {
    const handlers = {
      submitTranscodeJob: vi.fn(() => 'local-job-1'),
      cancelTranscodeJob: vi.fn((jobId: string) => jobId === 'local-job-1'),
      scheduleTranscodeCleanup: vi.fn(),
      runPreTokenGeneration: vi.fn(async () => {}),
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
    expect(handlers.submitTranscodeJob).toHaveBeenCalledWith(job);
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
    expect(handlers.scheduleTranscodeCleanup).toHaveBeenCalledWith({ payload });
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
    expect(handlers.runPreTokenGeneration).toHaveBeenCalledWith(signIn);
  });

  it('refuses a sign-in without the user’s sub', async () => {
    const { handlers, url } = start();
    await new Promise((resolve) => server!.once('listening', resolve));

    const response = await fetch(url('/triggers/pre-token-generation'), {
      method: 'POST',
      ...json({ userName: 'erin', userAttributes: {} }),
    });

    expect(response.status).toBe(400);
    expect(handlers.runPreTokenGeneration).not.toHaveBeenCalled();
  });
});
