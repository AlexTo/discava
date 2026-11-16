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
| Loss | None within the stream's retention while the router is up. A record the router can't send is retried by the stream mapping, then set aside in the router's failure queue |
| Size | A record too large for the queue is refused by the router and goes to the router's failure queue (research R-4) |

## Failure

A handler that throws leaves its batch's messages to become visible again after the visibility timeout. After `maxReceiveCount` receives a message moves to the feature's failure queue, where the alarm trips. Because SQS cannot bisect a batch, a failing message can carry its batch-mates with it; redriving them is safe by the handler obligations.

## Replay

Deployed: the queue service's own redrive from the failure queue to its source queue (a documented manual step, FR-017). Locally: `POST /router/redrive/{feature}` ([local-runner-routes.md](./local-runner-routes.md)).
