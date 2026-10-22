/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createServer, type IncomingMessage } from 'node:http';
import type {
  LocalScheduleRequest,
  LocalSignInRequest,
  LocalTranscodeJobRequest,
} from '@discava/common-server-utils/local-dev';
// The event runner's HTTP interface for the local service stand-ins described
// in common-server-utils/local-dev.

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
};

/**
 * Starts the event runner's HTTP server on `port`, which local dev calls
 * instead of AWS (see callLocalEventRunner). Each endpoint hands the request
 * to the matching callback, which the event runner wires to the transcoder or
 * the real handler:
 * - `POST /transcode-jobs` (LocalTranscodeJobRequest) -> `{ jobId }`, as
 *   MediaConvert's CreateJob
 * - `DELETE /transcode-jobs/<jobId>`, as CancelJob (404 if there's no such
 *   job left to finish)
 * - `POST /schedules/transcode-cleanup` (LocalScheduleRequest), as a one-off
 *   Scheduler schedule targeting transcode-cleanup
 * - `POST /triggers/pre-token-generation` (LocalSignInRequest), as Cognito
 *   running its pre token generation trigger at sign-in; answers 204 once
 *   the handler has run (400 without `userName` and `userAttributes.sub`)
 */
export const startEventRunnerServer = ({
  port,
  submitTranscodeJob,
  cancelTranscodeJob,
  scheduleTranscodeCleanup,
  runPreTokenGeneration,
  log,
}: {
  port: number;
  submitTranscodeJob: (request: LocalTranscodeJobRequest) => string;
  cancelTranscodeJob: (jobId: string) => boolean;
  scheduleTranscodeCleanup: (request: LocalScheduleRequest) => void;
  runPreTokenGeneration: (request: LocalSignInRequest) => Promise<void>;
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
        const jobId = submitTranscodeJob(job);
        log(`transcode job ${jobId} queued for ${job.inputKey}`);
        return send(201, { jobId });
      }
      const canceled = path.match(/^\/transcode-jobs\/([^/]+)$/);
      if (request.method === 'DELETE' && canceled) {
        const jobId = decodeURIComponent(canceled[1]);
        return cancelTranscodeJob(jobId)
          ? send(204)
          : send(404, { message: 'No such job' });
      }
      if (
        request.method === 'POST' &&
        path === '/schedules/transcode-cleanup'
      ) {
        scheduleTranscodeCleanup(
          (await readJson(request)) as LocalScheduleRequest,
        );
        return send(202);
      }
      if (
        request.method === 'POST' &&
        path === '/triggers/pre-token-generation'
      ) {
        const signedIn = (await readJson(request)) as LocalSignInRequest;
        if (
          !signedIn.userName ||
          typeof signedIn.userAttributes?.sub !== 'string'
        ) {
          return send(400, {
            message: 'userName and userAttributes.sub needed',
          });
        }
        // Answered once the trigger has run, so the API's first request
        // after sign-in already finds the user's record.
        await runPreTokenGeneration(signedIn);
        return send(204);
      }
      send(404, { message: `No ${request.method} ${path}` });
    } catch (error) {
      send(500, { message: (error as Error).message });
    }
  });
  server.listen(port);
  return server;
};
