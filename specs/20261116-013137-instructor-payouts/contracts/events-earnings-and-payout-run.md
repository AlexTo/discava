# Contract: events handlers

## `events-earnings-recording` (stream router feature `earnings-recording`)

Trigger: the feature's queue. Earnings recording is registered in core-table's `STREAM_FEATURES` as `earnings-recording` and never reads the table's stream itself; the `StreamRouter` is the stream's only reader and copies each matching record to this feature's queue.

| Registration field | Value |
|---|---|
| `name`, `handler` | `earnings-recording` |
| `filters` | `EARNINGS_STREAM_FILTERS` (core-table `helpers/earnings-stream.ts`): INSERT and MODIFY of `order`, INSERT of `refund` |
| `batch` | 100 records / 5 s |
| `maxReceiveCount` | 5 |
| `maxConcurrency` | 2 (sales of one course share an `earningDay` row; plan risk R6) |

The queue, failure queue, alarm and the queue's event source mapping come from the `StreamRouter` construct, and the local event runner builds the same from the entry over ElasticMQ. The handler reads its records through `sqsToStreamRecords` (`packages/events/src/router/sqs-stream-records.ts`).

Behaviour:

- Paid order: an `order` record counts once it carries `paidAt` (assumed shape, T010); any other order record is skipped. Read the course's `courseInstructor` records, call `recordSale` with the stage's fee. No instructors, or `paidMinor` of 0, records nothing.
- Refund: read the order's `earningOrder` (its fee, instructors and `refundedMinor`), then call `recordRefund`, which computes the share from the amount already recorded as refunded (not from refund timestamps), serialises per order with a condition on `earningOrder.refundedMinor` and retries the read-compute-write up to 5 times if another refund was recorded first. An order with no sale entries because it was free or unpaid is ignored without error.
- Delivery is at least once and in no guaranteed order (router handler obligations, FR-011), and the handler is safe under both. Both helpers are idempotent by entry key, so a duplicate or redelivered record changes nothing. Refunds may be processed in any order: the entries always sum to the sale's fee and amounts once the recorded total equals the amount paid. A later change to a paid order (for example its status after a refund) delivered before or after the paid one records the sale once. The handler's header comment says this.
- Within a batch the handler applies order records before refund records, so a refund batched with its sale succeeds the first time. A refund that arrives before its paid order has been recorded (a paid order with no `earningOrder`) throws.
- Failures: the handler applies every record it can, then throws if any failed (no `batchItemFailures`), so the queue redelivers the whole batch after its visibility timeout and the redelivery changes nothing already applied. After 5 receives the message moves to the `earnings-recording` failure queue and its alarm fires. Nothing is lost or half-recorded: redriving the failure queue once the cause is fixed (`POST /router/redrive/earnings-recording` locally, the SQS redrive when deployed) records what is missing.
- Its writes are routed to no feature: `featuresFor` returns nothing for `earningEntry`, `earningDay` and `earningOrder` records (no feedback loop, FR-015).

Environment: table name, `PLATFORM_FEE_BASIS_POINTS`, `PAYOUT_HOLD_DAYS` (from stage config, set by the router's stack; by the event runner locally).

## `events-payout-run` (scheduled, daily)

Trigger: EventBridge Scheduler once a day (a timer in the local event runner, plus `POST /payout-run` on its port for tests).

Behaviour:

1. Recover pending payouts, for every instructor whatever their account state: list `pending` payouts (`payoutsByStatus`); skip any whose `attemptedAt` is newer than the 15-minute grace (another run may be sending it); claim each remaining one by a conditional update of `attemptedAt` (a run that loses the claim skips it); list Stripe transfers by `transfer_group` = `payoutId`; if one exists, `markPayoutSent` with it and do not send again; otherwise create the transfer (step 4's call) and classify the outcome as below.
2. For each account from `byStatus` = `active`: retrieve it from Stripe; if it is no longer active, store the new status and skip it.
3. Per currency, sum the instructor's open entries whose `releaseAt` has passed. If the sum is below `PAYOUT_MINIMUM_MINOR` (including zero or negative), do nothing.
4. `createPayout` (the pending payout and each entry's `payoutId` in one transaction), create the Stripe transfer with `transfer_group` and metadata set to the payout ID and the payout ID as idempotency key, then classify the outcome: success gives `markPayoutSent` (stores the transfer ID); a definite Stripe rejection (a 4xx invalid-request or permission error) gives `markPayoutFailed` (stores the reason, clears the entries' `payoutId`, restoring their open key); anything uncertain (an idempotency conflict from a request with the same key still in flight, a timeout or connection error, a 5xx, a rate limit) leaves the payout `pending` for step 1 of a later run. A payout is never marked failed on an uncertain outcome.
5. One instructor's failure does not stop the others. The run throws at the end if any instructor failed unexpectedly (a Stripe rejection is not unexpected: it is a recorded Failed payout).

Running twice, or two runs at once, sends nothing twice: the second finds no open released entries, loses the payout transaction's condition, or loses the recovery claim. A pending payout older than Stripe's idempotency window whose transfer already exists is marked sent, not resent.

Environment: table name, Stripe secret reference, `PAYOUT_MINIMUM_MINOR`.
