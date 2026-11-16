# Contract: Router Message

What the router sends to a feature's queue, and what the feature's handler receives.

## Message

- **Body**: one stream record as JSON, in the shape a Lambda receives from a DynamoDB stream mapping (`eventID`, `eventName`, `eventVersion`, `eventSource`, `awsRegion`, `eventSourceARN`, `dynamodb` with `Keys`, `NewImage`, `OldImage`, `SequenceNumber`, `SizeBytes`, `StreamViewType`, `ApproximateCreationDateTime`). Images stay in DynamoDB-JSON.
- **Message attributes** (strings): `feature` (the registration name), `entity` (the record's `__edb_e__`).
- **One record per message**, so a message maps to one change and the receive count counts attempts at that change.

## Handler input

`sqs-stream-records.ts` turns an SQS event into `{ Records: DynamoDBRecord[] }` in arrival order within the batch, so the handlers' existing parser (`DynamoDBStreamSchema`) and unit tests are unchanged. Batch size and window come from the registration (100 and 5 s).

## Guarantees and non-guarantees

| | |
|---|---|
| Delivery | At least once. A record can arrive twice |
| Order | None between records, even for the same item (research R-1) |
| Loss | None within the stream's retention while the router is up, except a record the router can never send (too large for the queue, or unroutable). The router writes that record's identity to its failure queue (not the record), reports it handled, and the record is repaired by `search-reindex` or the next change to the item (research R-4). A transient send error is retried by the stream mapping, which blocks the shard while it does; if retries run out the mapping's `onFailure` destination holds only the shard ID and sequence-number range, so the records are lost once past the stream's 24-hour retention |
| Size | A record too large for the queue is never sent. The router writes its `eventID`, keys, entity, matching features and size to the router's failure queue and returns success for it, so it doesn't hold up its shard (research R-4) |

## Failure

A handler that throws leaves its batch's messages to become visible again after the visibility timeout. After `maxReceiveCount` receives a message moves to the feature's failure queue, where the alarm trips. Because SQS cannot bisect a batch, a failing message can carry its batch-mates with it; redriving them is safe by the handler obligations.

## Replay

Deployed: the queue service's own redrive from the failure queue to its source queue (a documented manual step, FR-017). Locally: `POST /router/redrive/{feature}` ([local-runner-routes.md](./local-runner-routes.md)).
