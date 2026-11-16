/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import type {
  QueueClient,
  QueueDepth,
  QueueMessage,
  ReceivedMessage,
} from '../router/queue-client.js';

interface Stored extends QueueMessage {
  id: string;
  receiveCount: number;
  receiptHandle?: string;
  visibleAt: number;
}

export interface InProcessQueueOptions {
  /** How long a received message stays hidden before it returns. */
  visibilityTimeoutMs?: number;
  /**
   * A queue's failure queue, and the receives after which a message that
   * returns goes there instead of being delivered again, as SQS's redrive
   * policy does.
   */
  redrive?: Readonly<
    Record<string, { failureQueue: string; maxReceiveCount: number }>
  >;
  now?: () => number;
}

/**
 * A QueueClient that keeps messages in memory: the fallback local stand-in
 * for SQS, and the fake the unit tests use. Models what the router and the
 * feature runners depend on: a visibility timeout, a receive count, and
 * redrive to a failure queue.
 */
export const createInProcessQueue = ({
  visibilityTimeoutMs = 30_000,
  redrive = {},
  now = Date.now,
}: InProcessQueueOptions = {}): QueueClient & {
  /** The messages held in a queue, visible or not, without receiving them. */
  peek(queue: string): readonly QueueMessage[];
} => {
  const queues = new Map<string, Stored[]>();
  const listOf = (queue: string) => {
    let list = queues.get(queue);
    if (!list) {
      list = [];
      queues.set(queue, list);
    }
    return list;
  };

  const add = (queue: string, message: QueueMessage) =>
    listOf(queue).push({
      body: message.body,
      attributes: message.attributes,
      id: randomUUID(),
      receiveCount: 0,
      visibleAt: 0,
    });

  // Moves messages that have used up their receives to the failure queue.
  const redriveExhausted = (queue: string) => {
    const policy = redrive[queue];
    if (!policy) return;
    const list = listOf(queue);
    for (const message of [...list]) {
      if (
        message.visibleAt <= now() &&
        message.receiveCount >= policy.maxReceiveCount
      ) {
        list.splice(list.indexOf(message), 1);
        add(policy.failureQueue, message);
      }
    }
  };

  return {
    async sendBatch(queue, messages) {
      for (const message of messages) add(queue, message);
      return [];
    },
    async receive(queue, max) {
      redriveExhausted(queue);
      const received: ReceivedMessage[] = [];
      for (const message of listOf(queue)) {
        if (received.length >= max) break;
        if (message.visibleAt > now()) continue;
        message.receiveCount += 1;
        message.visibleAt = now() + visibilityTimeoutMs;
        message.receiptHandle = randomUUID();
        received.push({
          id: message.id,
          body: message.body,
          attributes: message.attributes,
          receiptHandle: message.receiptHandle,
          receiveCount: message.receiveCount,
        });
      }
      return received;
    },
    async delete(queue, receiptHandle) {
      const list = listOf(queue);
      const index = list.findIndex((m) => m.receiptHandle === receiptHandle);
      if (index >= 0) list.splice(index, 1);
    },
    async move(from, to, message) {
      add(to, message);
      await this.delete(from, message.receiptHandle);
    },
    async depth(queue): Promise<QueueDepth> {
      redriveExhausted(queue);
      const list = listOf(queue);
      const inFlight = list.filter((m) => m.visibleAt > now()).length;
      return { waiting: list.length - inFlight, inFlight };
    },
    peek: (queue) =>
      listOf(queue).map(({ body, attributes }) => ({ body, attributes })),
  };
};
