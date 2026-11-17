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

const email = {
  to: 'a@example.com',
  from: 'notifications@discava.local',
  subject: 'Hi <b>',
  text: 'text',
  html: '<p>html</p>',
  headers: { 'List-Unsubscribe': '<https://x>' },
};
const stored = {
  id: '2f1c1f0e-8c7a-4a3e-9d58-3a0a9f8f6b11',
  receivedAt: '2026-11-17T00:00:00.000Z',
  ...email,
};

describe('startEventRunnerServer', () => {
  let server: ReturnType<typeof startEventRunnerServer> | undefined;
  afterEach(() => {
    server?.close();
    vi.unstubAllEnvs();
  });

  const start = () => {
    const handlers = {
      submitTranscodeJob: vi.fn(() => 'local-job-1'),
      cancelTranscodeJob: vi.fn((jobId: string) => jobId === 'local-job-1'),
      submitTranscriptionJob: vi.fn(),
      scheduleTranscodeCleanup: vi.fn(),
      runPreTokenGeneration: vi.fn(async () => {}),
      emailInbox: {
        store: vi.fn(async () => ({ id: 'email-1' })),
        list: vi.fn(async () => [stored]),
        get: vi.fn(async (id: string) =>
          id === stored.id ? stored : undefined,
        ),
      },
      routerQueues: vi.fn(async () => ({
        features: [
          {
            name: 'search-indexing',
            queue: { waiting: 1, inFlight: 0 },
            failures: { count: 2 },
          },
        ],
      })),
      redriveFeature: vi.fn(async (feature: string) =>
        feature === 'search-indexing' ? 2 : undefined,
      ),
      failFeature: vi.fn((feature: string, batches: number) =>
        feature === 'search-indexing' ? batches : undefined,
      ),
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

  it('accepts a transcription job, as StartTranscriptionJob does', async () => {
    const { handlers, url } = start();
    await new Promise((resolve) => server!.once('listening', resolve));
    const job = {
      jobName: 'captions-item-1-nonce-1',
      tags: { courseId: 'course-1' },
      outputBucket: 'media',
      outputKey: 'out/nonce-1/',
    };

    const response = await fetch(url('/transcription-jobs'), {
      method: 'POST',
      ...json(job),
    });

    expect(response.status).toBe(202);
    expect(handlers.submitTranscriptionJob).toHaveBeenCalledWith(job);
  });

  it('refuses a transcription job without somewhere to put its output', async () => {
    const { handlers, url } = start();
    await new Promise((resolve) => server!.once('listening', resolve));

    const response = await fetch(url('/transcription-jobs'), {
      method: 'POST',
      ...json({
        jobName: 'job',
        tags: {},
        outputBucket: 'media',
        outputKey: 'no-slash',
      }),
    });

    expect(response.status).toBe(400);
    expect(handlers.submitTranscriptionJob).not.toHaveBeenCalled();
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

  it('reports each feature’s queue and failure queue', async () => {
    const { url } = start();
    await new Promise((resolve) => server!.once('listening', resolve));

    const response = await fetch(url('/router/queues'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      features: [
        {
          name: 'search-indexing',
          queue: { waiting: 1, inFlight: 0 },
          failures: { count: 2 },
        },
      ],
    });
  });

  it('redrives a feature’s failure queue, answering how many moved', async () => {
    const { handlers, url } = start();
    await new Promise((resolve) => server!.once('listening', resolve));

    const response = await fetch(url('/router/redrive/search-indexing'), {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      feature: 'search-indexing',
      redriven: 2,
    });
    expect(handlers.redriveFeature).toHaveBeenCalledWith('search-indexing');
  });

  it('answers 404 to redriving or failing an unregistered feature', async () => {
    vi.stubEnv('LOCAL_DEV', 'true');
    const { url } = start();
    await new Promise((resolve) => server!.once('listening', resolve));

    const redrive = await fetch(url('/router/redrive/nope'), {
      method: 'POST',
    });
    const fail = await fetch(url('/router/fail/nope'), {
      method: 'POST',
      ...json({ batches: 1 }),
    });

    expect(redrive.status).toBe(404);
    expect(fail.status).toBe(404);
  });

  describe('POST /router/fail/{feature}', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('makes the feature fail its next batches', async () => {
      vi.stubEnv('LOCAL_DEV', 'true');
      const { handlers, url } = start();
      await new Promise((resolve) => server!.once('listening', resolve));

      const response = await fetch(url('/router/fail/search-indexing'), {
        method: 'POST',
        ...json({ batches: 5 }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        feature: 'search-indexing',
        failing: 5,
      });
      expect(handlers.failFeature).toHaveBeenCalledWith('search-indexing', 5);
    });

    it('answers 403 unless LOCAL_DEV is true', async () => {
      vi.stubEnv('LOCAL_DEV', undefined);
      const { handlers, url } = start();
      await new Promise((resolve) => server!.once('listening', resolve));

      const response = await fetch(url('/router/fail/search-indexing'), {
        method: 'POST',
        ...json({ batches: 5 }),
      });

      expect(response.status).toBe(403);
      expect(handlers.failFeature).not.toHaveBeenCalled();
    });

    it('refuses a batch count that isn’t a whole number', async () => {
      vi.stubEnv('LOCAL_DEV', 'true');
      const { url } = start();
      await new Promise((resolve) => server!.once('listening', resolve));

      const response = await fetch(url('/router/fail/search-indexing'), {
        method: 'POST',
        ...json({ batches: 'many' }),
      });

      expect(response.status).toBe(400);
    });
  });

  it('stores an email, as SES SendEmail takes it, and answers with its id', async () => {
    const { handlers, url } = start();
    await new Promise((resolve) => server!.once('listening', resolve));

    const response = await fetch(url('/emails'), {
      method: 'POST',
      ...json(email),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 'email-1' });
    expect(handlers.emailInbox.store).toHaveBeenCalledWith(email);
  });

  it('refuses an email without a recipient or body', async () => {
    const { handlers, url } = start();
    await new Promise((resolve) => server!.once('listening', resolve));

    const response = await fetch(url('/emails'), {
      method: 'POST',
      ...json({ ...email, to: undefined }),
    });

    expect(response.status).toBe(400);
    expect(handlers.emailInbox.store).not.toHaveBeenCalled();
  });

  it('lists the stored emails as JSON', async () => {
    const { url } = start();
    await new Promise((resolve) => server!.once('listening', resolve));

    const response = await fetch(url('/emails'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([stored]);
  });

  it('serves the inbox and a message as HTML, escaped', async () => {
    const { url } = start();
    await new Promise((resolve) => server!.once('listening', resolve));

    const list = await fetch(url('/inbox'));
    expect(list.headers.get('content-type')).toContain('text/html');
    const listHtml = await list.text();
    expect(listHtml).toContain(`/inbox/${stored.id}`);
    expect(listHtml).toContain('Hi &lt;b&gt;');

    const one = await fetch(url(`/inbox/${stored.id}`));
    expect(one.status).toBe(200);
    expect(await one.text()).toContain('<iframe');
  });

  it('answers 404 for an unknown message', async () => {
    const { url } = start();
    await new Promise((resolve) => server!.once('listening', resolve));

    expect((await fetch(url('/inbox/nope'))).status).toBe(404);
  });
});
