/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type {
  LocalScheduleRequest,
  LocalTranscodeJobRequest,
} from '@discava/common-server-utils/local-dev';

// The event runner's endpoints for what MediaConvert and EventBridge
// Scheduler do when deployed (#137): instructor-api and the event handlers
// call these instead in local dev (see common-server-utils/local-dev).

/**
 * The EventBridge event MediaConvert emits when a job finishes, as the
 * TranscodeComplete rule delivers it to transcode-complete.
 */
export const transcodeCompletionEvent = (
  jobId: string,
  status: 'COMPLETE' | 'ERROR',
  userMetadata: Record<string, string>,
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

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
};

/**
 * Serves:
 * - `POST /transcode-jobs` (LocalTranscodeJobRequest) -> `{ jobId }`, as
 *   MediaConvert's CreateJob
 * - `DELETE /transcode-jobs/<jobId>`, as CancelJob (404 if there's no such
 *   job left to finish)
 * - `POST /schedules/transcode-cleanup` (LocalScheduleRequest), as a one-off
 *   Scheduler schedule targeting transcode-cleanup
 */
export const startMediaJobsServer = ({
  port,
  submit,
  cancel,
  schedule,
  log,
}: {
  port: number;
  submit: (request: LocalTranscodeJobRequest) => string;
  cancel: (jobId: string) => boolean;
  schedule: (request: LocalScheduleRequest) => void;
  log: (message: string) => void;
}) => {
  const server = createServer(async (request, response) => {
    const send = (status: number, body?: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(body === undefined ? '' : JSON.stringify(body));
    };
    try {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (request.method === 'POST' && path === '/transcode-jobs') {
        const job = (await readJson(request)) as LocalTranscodeJobRequest;
        if (!job.inputKey || !job.outputPrefix?.endsWith('/')) {
          return send(400, {
            message: 'inputKey and outputPrefix (…/) needed',
          });
        }
        const jobId = submit(job);
        log(`transcode job ${jobId} queued for ${job.inputKey}`);
        return send(201, { jobId });
      }
      const canceled = path.match(/^\/transcode-jobs\/([^/]+)$/);
      if (request.method === 'DELETE' && canceled) {
        const jobId = decodeURIComponent(canceled[1]);
        return cancel(jobId)
          ? send(204)
          : send(404, { message: 'No such job' });
      }
      if (
        request.method === 'POST' &&
        path === '/schedules/transcode-cleanup'
      ) {
        schedule((await readJson(request)) as LocalScheduleRequest);
        return send(202);
      }
      send(404, { message: `No ${request.method} ${path}` });
    } catch (error) {
      send(500, { message: (error as Error).message });
    }
  });
  server.listen(port);
  return server;
};
