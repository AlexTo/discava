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
