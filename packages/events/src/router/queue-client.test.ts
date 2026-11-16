/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@aws-sdk/client-sqs', () => {
  const command = (name: string) =>
    class {
      constructor(public input: unknown) {
        Object.assign(this, { name });
      }
    };
  return {
    SendMessageBatchCommand: command('SendMessageBatch'),
    ReceiveMessageCommand: command('ReceiveMessage'),
    DeleteMessageCommand: command('DeleteMessage'),
    GetQueueAttributesCommand: command('GetQueueAttributes'),
  };
});

import {
  createSqsQueueClient,
  MAX_MESSAGE_BYTES,
  messageBytes,
} from './queue-client.js';

type Sent = { name: string; input: Record<string, unknown> };

const fakeSqs = (respond: (sent: Sent) => unknown) => {
  const calls: Sent[] = [];
  return {
    calls,
    sqs: {
      send: vi.fn(async (command: Sent) => {
        calls.push(command);
        return respond(command);
      }),
    } as never,
  };
};

const message = (n: number) => ({ body: `{"n":${n}}`, attributes: { a: 'b' } });

describe('createSqsQueueClient', () => {
  it('sends messages ten to a call, with their attributes', async () => {
    const { sqs, calls } = fakeSqs(() => ({}));
    const client = createSqsQueueClient(sqs);
    const failures = await client.sendBatch(
      'q',
      Array.from({ length: 25 }, (_, n) => message(n)),
    );
    expect(failures).toEqual([]);
    expect(calls.map((c) => (c.input.Entries as unknown[]).length)).toEqual([
      10, 10, 5,
    ]);
    const first = (calls[0]?.input.Entries as Record<string, unknown>[])[0];
    expect(first).toMatchObject({
      Id: '0',
      MessageBody: '{"n":0}',
      MessageAttributes: { a: { DataType: 'String', StringValue: 'b' } },
    });
  });

  it('reports a failed entry by its index in the messages passed', async () => {
    const { sqs } = fakeSqs((sent) =>
      sent.input.Entries &&
      (sent.input.Entries as { Id: string }[])[0]?.Id === '10'
        ? { Failed: [{ Id: '12', SenderFault: false, Message: 'throttled' }] }
        : {},
    );
    const failures = await createSqsQueueClient(sqs).sendBatch(
      'q',
      Array.from({ length: 15 }, (_, n) => message(n)),
    );
    expect(failures).toEqual([
      { index: 12, transient: true, reason: 'throttled' },
    ]);
  });

  it('marks a sender-fault failure as not transient', async () => {
    const { sqs } = fakeSqs(() => ({
      Failed: [{ Id: '0', SenderFault: true, Message: 'bad' }],
    }));
    const failures = await createSqsQueueClient(sqs).sendBatch('q', [
      message(0),
    ]);
    expect(failures[0]?.transient).toBe(false);
  });

  it('reports every entry of a call that threw as transient', async () => {
    const sqs = {
      send: vi.fn().mockRejectedValue(new Error('boom')),
    } as never;
    const failures = await createSqsQueueClient(sqs).sendBatch('q', [
      message(0),
      message(1),
    ]);
    expect(failures.map((f) => [f.index, f.transient])).toEqual([
      [0, true],
      [1, true],
    ]);
  });

  it('receives messages with attributes and receive count', async () => {
    const { sqs, calls } = fakeSqs(() => ({
      Messages: [
        {
          MessageId: 'm1',
          Body: 'x',
          ReceiptHandle: 'r1',
          MessageAttributes: { feature: { StringValue: 'f' } },
          Attributes: { ApproximateReceiveCount: '3' },
        },
      ],
    }));
    const received = await createSqsQueueClient(sqs).receive('q', 50, 1);
    expect(calls[0]?.input).toMatchObject({
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 1,
    });
    expect(received).toEqual([
      {
        id: 'm1',
        body: 'x',
        attributes: { feature: 'f' },
        receiptHandle: 'r1',
        receiveCount: 3,
      },
    ]);
  });

  it('moves a message by sending it on and deleting the original', async () => {
    const { sqs, calls } = fakeSqs(() => ({}));
    await createSqsQueueClient(sqs).move('from', 'to', {
      ...message(1),
      id: 'm',
      receiptHandle: 'r',
      receiveCount: 5,
    });
    expect(calls.map((c) => [c.name, c.input.QueueUrl])).toEqual([
      ['SendMessageBatch', 'to'],
      ['DeleteMessage', 'from'],
    ]);
  });

  it('does not delete a message it could not move', async () => {
    const { sqs, calls } = fakeSqs(() => ({
      Failed: [{ Id: '0', SenderFault: false }],
    }));
    await expect(
      createSqsQueueClient(sqs).move('from', 'to', {
        ...message(1),
        id: 'm',
        receiptHandle: 'r',
        receiveCount: 5,
      }),
    ).rejects.toThrow();
    expect(calls.map((c) => c.name)).toEqual(['SendMessageBatch']);
  });

  it('reads the queue depth', async () => {
    const { sqs } = fakeSqs(() => ({
      Attributes: {
        ApproximateNumberOfMessages: '2',
        ApproximateNumberOfMessagesNotVisible: '1',
      },
    }));
    expect(await createSqsQueueClient(sqs).depth('q')).toEqual({
      waiting: 2,
      inFlight: 1,
    });
  });
});

describe('messageBytes', () => {
  it('counts body and attributes, and the limit is 1 MiB', () => {
    expect(messageBytes({ body: 'abc', attributes: {} })).toBe(3);
    expect(messageBytes({ body: 'abc', attributes: { a: 'b' } })).toBe(
      3 + 1 + 1 + 6,
    );
    expect(MAX_MESSAGE_BYTES).toBe(1_048_576);
  });
});
