/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageBatchCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';

/**
 * The most an SQS message can hold, body and attributes together: 1,048,576
 * bytes (1 MiB), per the SQS developer guide's message quotas, read when this
 * was written (research R-4).
 */
export const MAX_MESSAGE_BYTES = 1_048_576;

/** SendMessageBatch takes at most 10 entries. */
export const SEND_BATCH_SIZE = 10;

export interface QueueMessage {
  body: string;
  /** String message attributes. */
  attributes: Readonly<Record<string, string>>;
}

export interface ReceivedMessage extends QueueMessage {
  id: string;
  /** Hands the message back to the queue it came from, or deletes it. */
  receiptHandle: string;
  receiveCount: number;
}

export interface SendFailure {
  /** Index in the messages passed to `sendBatch`. */
  index: number;
  /** Whether a retry could succeed (throttling, a service error). */
  transient: boolean;
  reason: string;
}

export interface QueueDepth {
  waiting: number;
  inFlight: number;
}

/**
 * The few queue operations the router and the local feature runners use, so
 * local dev can swap SQS (ElasticMQ) for an in-process queue.
 */
export interface QueueClient {
  /** Sends messages, at most 10 per call; returns those that failed. */
  sendBatch(
    queue: string,
    messages: readonly QueueMessage[],
  ): Promise<readonly SendFailure[]>;
  /** Receives up to `max` messages, waiting up to `waitSeconds` for some. */
  receive(
    queue: string,
    max: number,
    waitSeconds: number,
  ): Promise<readonly ReceivedMessage[]>;
  delete(queue: string, receiptHandle: string): Promise<void>;
  /** Sends the message to `to` and deletes it from `from`. */
  move(from: string, to: string, message: ReceivedMessage): Promise<void>;
  depth(queue: string): Promise<QueueDepth>;
}

/** The size SQS counts for a message: its body and attributes. */
export const messageBytes = (message: QueueMessage): number =>
  Buffer.byteLength(message.body) +
  Object.entries(message.attributes).reduce(
    (sum, [name, value]) =>
      sum +
      Buffer.byteLength(name) +
      Buffer.byteLength(value) +
      'String'.length,
    0,
  );

// Failures SQS reports per entry as the sender's fault won't succeed on retry.
const isTransient = (senderFault: boolean | undefined, code?: string) =>
  !senderFault && code !== 'AWS.SimpleQueueService.NonExistentQueue';

/** A QueueClient over SQS. `queue` is a queue URL. */
export const createSqsQueueClient = (sqs: SQSClient): QueueClient => {
  const sendBatch: QueueClient['sendBatch'] = async (queue, messages) => {
    const failures: SendFailure[] = [];
    for (let start = 0; start < messages.length; start += SEND_BATCH_SIZE) {
      const chunk = messages.slice(start, start + SEND_BATCH_SIZE);
      try {
        const result = await sqs.send(
          new SendMessageBatchCommand({
            QueueUrl: queue,
            Entries: chunk.map((message, i) => ({
              Id: String(start + i),
              MessageBody: message.body,
              MessageAttributes: Object.fromEntries(
                Object.entries(message.attributes).map(([name, value]) => [
                  name,
                  { DataType: 'String', StringValue: value },
                ]),
              ),
            })),
          }),
        );
        for (const failed of result.Failed ?? []) {
          failures.push({
            index: Number(failed.Id),
            transient: isTransient(failed.SenderFault, failed.Code),
            reason: failed.Message ?? failed.Code ?? 'send failed',
          });
        }
      } catch (error) {
        // The whole call failed: every entry in it may be retried.
        chunk.forEach((_, i) =>
          failures.push({
            index: start + i,
            transient: true,
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
    return failures;
  };

  return {
    sendBatch,
    async receive(queue, max, waitSeconds) {
      const result = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queue,
          MaxNumberOfMessages: Math.min(max, 10),
          WaitTimeSeconds: waitSeconds,
          MessageAttributeNames: ['All'],
          MessageSystemAttributeNames: ['ApproximateReceiveCount'],
        }),
      );
      return (result.Messages ?? []).map((message) => ({
        id: message.MessageId ?? '',
        body: message.Body ?? '',
        attributes: Object.fromEntries(
          Object.entries(message.MessageAttributes ?? {}).map(
            ([name, value]) => [name, value.StringValue ?? ''],
          ),
        ),
        receiptHandle: message.ReceiptHandle ?? '',
        receiveCount: Number(message.Attributes?.ApproximateReceiveCount ?? 1),
      }));
    },
    async delete(queue, receiptHandle) {
      await sqs.send(
        new DeleteMessageCommand({
          QueueUrl: queue,
          ReceiptHandle: receiptHandle,
        }),
      );
    },
    async move(from, to, message) {
      const failures = await sendBatch(to, [message]);
      if (failures.length > 0) {
        throw new Error(`Could not move message: ${failures[0]?.reason}`);
      }
      await this.delete(from, message.receiptHandle);
    },
    async depth(queue) {
      const result = await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: queue,
          AttributeNames: [
            'ApproximateNumberOfMessages',
            'ApproximateNumberOfMessagesNotVisible',
          ],
        }),
      );
      return {
        waiting: Number(result.Attributes?.ApproximateNumberOfMessages ?? 0),
        inFlight: Number(
          result.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0,
        ),
      };
    },
  };
};
