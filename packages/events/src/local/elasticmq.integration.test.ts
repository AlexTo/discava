/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageBatchCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { LOCAL_QUEUES } from '@discava/common-server-utils/local-dev';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSqsQueueClient } from '../router/queue-client.js';

// Runs the calls the local event runner makes against a real ElasticMQ
// container, beside the spike's (research R-2). Skipped when Docker isn't
// available; PR CI has it.
const dockerAvailable =
  spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;

const PORT = 9325;
const CONTAINER = 'discava-elasticmq-integration-test';
const CONFIG = `include classpath("application.conf")
node-address { protocol = http, host = "*", port = 9324, context-path = "" }
rest-sqs { enabled = true, bind-port = 9324, bind-hostname = "0.0.0.0", sqs-limits = strict }
queues {
  "test-failures" { defaultVisibilityTimeout = 2 seconds }
  "test" {
    defaultVisibilityTimeout = 2 seconds
    deadLettersQueue { name = "test-failures", maxReceiveCount = 2 }
  }
}
`;

describe.skipIf(!dockerAvailable)('ElasticMQ', () => {
  let dir: string;
  let sqs: SQSClient;
  const urls: Record<string, string> = {};

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'elasticmq-'));
    writeFileSync(join(dir, 'elasticmq.conf'), CONFIG);
    spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
    const run = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '-d',
        '--name',
        CONTAINER,
        '-p',
        `127.0.0.1:${PORT}:9324`,
        '-v',
        `${join(dir, 'elasticmq.conf')}:/opt/elasticmq.conf:ro`,
        LOCAL_QUEUES.image,
      ],
      { encoding: 'utf-8' },
    );
    if (run.status !== 0) throw new Error(run.stderr);
    sqs = new SQSClient({
      endpoint: `http://127.0.0.1:${PORT}`,
      region: LOCAL_QUEUES.region,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    });
    for (let attempt = 1; ; attempt++) {
      try {
        for (const name of ['test', 'test-failures']) {
          urls[name] = (
            await sqs.send(new GetQueueUrlCommand({ QueueName: name }))
          ).QueueUrl as string;
        }
        break;
      } catch (error) {
        if (attempt >= 60) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }, 120_000);

  afterAll(() => {
    spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const queue = () => createSqsQueueClient(sqs);
  const drain = async (url: string) => {
    for (;;) {
      const received = await queue().receive(url, 10, 0);
      if (received.length === 0) return;
      await Promise.all(
        received.map((m) => queue().delete(url, m.receiptHandle)),
      );
    }
  };

  it('sends a batch and receives its attributes and receive count', async () => {
    const url = urls.test as string;
    await drain(url);
    const failures = await queue().sendBatch(url, [
      {
        body: 'a',
        attributes: { feature: 'search-indexing', entity: 'Course' },
      },
    ]);
    expect(failures).toEqual([]);

    const [message] = await queue().receive(url, 10, 1);

    expect(message).toMatchObject({
      body: 'a',
      attributes: { feature: 'search-indexing', entity: 'Course' },
      receiveCount: 1,
    });
    expect((await queue().depth(url)).inFlight).toBe(1);
    await queue().delete(
      url,
      (message as { receiptHandle: string }).receiptHandle,
    );
  });

  it('asks for the feature and entity attributes by name', async () => {
    const url = urls.test as string;
    await queue().sendBatch(url, [
      { body: 'b', attributes: { feature: 'f', entity: 'e' } },
    ]);

    const result = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: url,
        MessageAttributeNames: ['feature', 'entity'],
        WaitTimeSeconds: 1,
      }),
    );

    expect(
      Object.keys(result.Messages?.[0]?.MessageAttributes ?? {}).sort(),
    ).toEqual(['entity', 'feature']);
    await drain(url);
    // Hidden until the 2 s visibility timeout passes.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await drain(url);
  });

  it('changes a message visibility and deletes messages in a batch', async () => {
    const url = urls.test as string;
    await drain(url);
    await queue().sendBatch(url, [
      { body: 'c1', attributes: {} },
      { body: 'c2', attributes: {} },
    ]);
    const received = await queue().receive(url, 10, 1);
    expect(received).toHaveLength(2);

    await sqs.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: url,
        ReceiptHandle: received[0]?.receiptHandle,
        VisibilityTimeout: 0,
      }),
    );
    const again = await queue().receive(url, 10, 1);
    expect(again.map((m) => m.body)).toEqual(['c1']);
    expect(again[0]?.receiveCount).toBe(2);

    const deleted = await sqs.send(
      new DeleteMessageBatchCommand({
        QueueUrl: url,
        // The first message's earlier handle went stale when it came back.
        Entries: [received[1], ...again].map((m, i) => ({
          Id: String(i),
          ReceiptHandle: m?.receiptHandle,
        })),
      }),
    );
    expect(deleted.Failed ?? []).toEqual([]);
    await drain(url);
  });

  it('moves a message to its failure queue after maxReceiveCount receives', async () => {
    const url = urls.test as string;
    const failureUrl = urls['test-failures'] as string;
    await drain(url);
    await drain(failureUrl);
    await queue().sendBatch(url, [{ body: 'poison', attributes: {} }]);

    for (const count of [1, 2]) {
      const [message] = await queue().receive(url, 1, 5);
      expect(message?.receiveCount).toBe(count);
      await sqs.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: url,
          ReceiptHandle: message?.receiptHandle,
          VisibilityTimeout: 0,
        }),
      );
    }
    expect(await queue().receive(url, 1, 1)).toEqual([]);

    const [dead] = await queue().receive(failureUrl, 1, 5);
    expect(dead?.body).toBe('poison');
  });

  it('moves a message between queues', async () => {
    const url = urls.test as string;
    const failureUrl = urls['test-failures'] as string;
    await drain(url);
    await drain(failureUrl);
    await queue().sendBatch(failureUrl, [{ body: 'redrive', attributes: {} }]);
    const [message] = await queue().receive(failureUrl, 1, 1);

    await queue().move(failureUrl, url, message as NonNullable<typeof message>);

    expect((await queue().receive(url, 1, 1)).map((m) => m.body)).toEqual([
      'redrive',
    ]);
    expect((await queue().depth(failureUrl)).waiting).toBe(0);
  });
});
