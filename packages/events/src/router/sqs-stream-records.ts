/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DynamoDBRecord, SQSEvent } from 'aws-lambda';

/**
 * Turns an SQS event carrying router messages into the `{ Records }` a
 * DynamoDB stream mapping delivers, so a feature's handler parses it with
 * `DynamoDBStreamSchema` unchanged. Records keep the batch's arrival order.
 */
export const sqsStreamRecords = (
  event: Pick<SQSEvent, 'Records'>,
): { Records: DynamoDBRecord[] } => ({
  Records: event.Records.map(
    (message) => JSON.parse(message.body) as DynamoDBRecord,
  ),
});

/**
 * A middy middleware for the feature handlers: when the event is the SQS
 * batch a feature's queue delivers, it becomes the `{ Records }` the handler
 * parses with `DynamoDBStreamSchema`, so the handler's logic is the same
 * behind the queue as it was behind the stream. An event already in the
 * stream shape (the local runner's, or a test's) passes through.
 */
export const sqsToStreamRecords = () => ({
  before: (request: { event: unknown }) => {
    const { Records } = request.event as {
      Records?: { eventSource?: string }[];
    };
    if (Records?.[0]?.eventSource === 'aws:sqs') {
      request.event = sqsStreamRecords(request.event as SQSEvent);
    }
  },
});
