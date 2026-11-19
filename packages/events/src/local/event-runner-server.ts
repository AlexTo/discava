/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createServer, type IncomingMessage } from 'node:http';
import type {
  LocalEmailRequest,
  LocalScheduleRequest,
  LocalSignInRequest,
  LocalTranscodeJobRequest,
  LocalTranscriptionJobRequest,
} from '@discava/common-server-utils/local-dev';
import {
  type EmailInbox,
  renderInboxPage,
  renderMessagePage,
} from './email-inbox.js';
import type { StripeStandIn } from './stripe-stand-in.js';

export interface LocalRouterFeatureState {
  name: string;
  queue: { waiting: number; inFlight: number };
  failures: { count: number };
}

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
 * - `POST /transcription-jobs` (LocalTranscriptionJobRequest) -> 202, as
 *   Transcribe's StartTranscriptionJob (the job finishes in the background)
 * - `POST /schedules/transcode-cleanup` (LocalScheduleRequest), as a one-off
 *   Scheduler schedule targeting transcode-cleanup
 * - `POST /triggers/pre-token-generation` (LocalSignInRequest), as Cognito
 *   running its pre token generation trigger at sign-in; answers 204 once
 *   the handler has run (400 without `userName` and `userAttributes.sub`)
 * - `POST /emails` (LocalEmailRequest) -> `{ id }`, as SES's SendEmail; the
 *   message is kept in the inbox
 * - `GET /emails` -> the stored messages, newest first
 * - `GET /inbox` -> an HTML list of them; `GET /inbox/<id>` -> one message
 *   (404 for an unknown id)
 * - `GET /router/queues` -> each stream feature's queue and failure queue
 *   state
 * - `POST /router/redrive/<feature>` -> `{ feature, redriven }`, moving the
 *   feature's failure queue back to its queue (404 for an unregistered
 *   feature)
 * - `POST /stripe/webhook` -> `handleStripeWebhook` on the exact bytes and
 *   `Stripe-Signature` header received, answering its status (400 for a
 *   message that doesn't verify), as the deployed webhook API does
 * - `/v1/*`, `/stripe/pay/*` and `/stripe/test/*` -> the Stripe stand-in (stripe-stand-in.ts),
 *   as Stripe's API
 * - `POST /router/fail/<feature>` (`{ batches }`) -> `{ feature, failing }`,
 *   making the feature's runner fail its next batches (404 for an
 *   unregistered feature; 403 unless `LOCAL_DEV=true`)
 */
export const startEventRunnerServer = ({
  port,
  submitTranscodeJob,
  cancelTranscodeJob,
  submitTranscriptionJob,
  scheduleTranscodeCleanup,
  runPreTokenGeneration,
  emailInbox,
  routerQueues,
  redriveFeature,
  failFeature,
  stripe,
  stripeWebhook,
  log,
}: {
  port: number;
  submitTranscodeJob: (request: LocalTranscodeJobRequest) => string;
  cancelTranscodeJob: (jobId: string) => boolean;
  submitTranscriptionJob: (request: LocalTranscriptionJobRequest) => void;
  scheduleTranscodeCleanup: (request: LocalScheduleRequest) => void;
  runPreTokenGeneration: (request: LocalSignInRequest) => Promise<void>;
  emailInbox: EmailInbox;
  routerQueues: () => Promise<{ features: LocalRouterFeatureState[] }>;
  /** The number moved, or undefined for an unregistered feature. */
  redriveFeature: (feature: string) => Promise<number | undefined>;
  /** The batches now set to fail, or undefined for an unregistered feature. */
  failFeature: (feature: string, batches: number) => number | undefined;
  /** The Stripe stand-in, answering Stripe's API paths when given. */
  stripe?: StripeStandIn;
  /** Applies a Stripe message: the status to answer with. */
  stripeWebhook?: (
    rawBody: Buffer,
    signature: string | undefined,
  ) => Promise<{ status: number }>;
  log: (message: string) => void;
}) => {
  const server = createServer(async (request, response) => {
    const send = (status: number, body?: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(body === undefined ? '' : JSON.stringify(body));
    };
    const sendHtml = (status: number, body: string) => {
      response.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
      });
      response.end(body);
    };
    try {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (stripe && (await stripe.handle(request, response, path))) {
        return;
      }
      if (
        request.method === 'POST' &&
        path === '/stripe/webhook' &&
        stripeWebhook
      ) {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        const signature = request.headers['stripe-signature'];
        const { status } = await stripeWebhook(
          Buffer.concat(chunks),
          typeof signature === 'string' ? signature : undefined,
        );
        return send(status, status === 200 ? { received: true } : undefined);
      }
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
      if (request.method === 'POST' && path === '/transcription-jobs') {
        const job = (await readJson(request)) as LocalTranscriptionJobRequest;
        if (
          !job.jobName ||
          !job.outputBucket ||
          !job.outputKey?.endsWith('/') ||
          typeof job.tags !== 'object' ||
          job.tags === null
        ) {
          return send(400, {
            message: 'jobName, tags, outputBucket and outputKey (…/) needed',
          });
        }
        submitTranscriptionJob(job);
        log(`transcription job ${job.jobName} queued`);
        return send(202);
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
      if (request.method === 'POST' && path === '/emails') {
        const email = (await readJson(request)) as LocalEmailRequest;
        if (
          !email.to ||
          !email.from ||
          typeof email.subject !== 'string' ||
          typeof email.text !== 'string' ||
          typeof email.html !== 'string' ||
          typeof email.headers !== 'object' ||
          email.headers === null
        ) {
          return send(400, {
            message: 'to, from, subject, text, html and headers needed',
          });
        }
        const { id } = await emailInbox.store(email);
        log(`email ${id} to ${email.to}: ${email.subject}`);
        return send(201, { id });
      }
      if (request.method === 'GET' && path === '/emails') {
        return send(200, await emailInbox.list());
      }
      if (request.method === 'GET' && path === '/inbox') {
        return sendHtml(200, renderInboxPage(await emailInbox.list()));
      }
      const inboxed = path.match(/^\/inbox\/([^/]+)$/);
      if (request.method === 'GET' && inboxed) {
        const email = await emailInbox.get(decodeURIComponent(inboxed[1]));
        return email
          ? sendHtml(200, renderMessagePage(email))
          : send(404, { message: 'No such email' });
      }
      if (request.method === 'GET' && path === '/router/queues') {
        return send(200, await routerQueues());
      }
      const router = path.match(/^\/router\/(redrive|fail)\/([^/]+)$/);
      if (request.method === 'POST' && router) {
        const feature = decodeURIComponent(router[2]);
        if (router[1] === 'redrive') {
          const redriven = await redriveFeature(feature);
          return redriven === undefined
            ? send(404, { message: `No feature ${feature}` })
            : send(200, { feature, redriven });
        }
        if (process.env.LOCAL_DEV !== 'true') {
          return send(403, { message: 'Only available when LOCAL_DEV=true' });
        }
        const { batches } = (await readJson(request)) as { batches?: unknown };
        if (!Number.isInteger(batches) || (batches as number) < 0) {
          return send(400, { message: 'batches (a whole number) needed' });
        }
        const failing = failFeature(feature, batches as number);
        return failing === undefined
          ? send(404, { message: `No feature ${feature}` })
          : send(200, { feature, failing });
      }
      send(404, { message: `No ${request.method} ${path}` });
    } catch (error) {
      send(500, { message: (error as Error).message });
    }
  });
  server.listen(port);
  return server;
};
