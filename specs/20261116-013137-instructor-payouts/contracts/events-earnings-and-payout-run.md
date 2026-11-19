# Contract: events handlers

## `events-earnings-recording` (stream router feature `earnings-recording`)

Trigger: the feature's queue. Earnings recording is registered in core-table's `STREAM_FEATURES` as `earnings-recording` and never reads the table's stream itself; the `StreamRouter` is the stream's only reader and copies each matching record to this feature's queue.

| Registration field | Value |
|---|---|
| `name`, `handler` | `earnings-recording` |
| `filters` | `EARNINGS_STREAM_FILTERS` (core-table `helpers/earnings-stream.ts`): INSERT and MODIFY of `order`, new image |
| `batch` | 100 records / 5 s |
| `maxReceiveCount` | 5 |
| `maxConcurrency` | 2 (sales of one course share an `earningDay` row; plan risk R6) |

The queue, failure queue, alarm and the queue's event source mapping come from the `StreamRouter` construct, and the local event runner builds the same from the entry over ElasticMQ. The handler reads its records through `sqsToStreamRecords` (`packages/events/src/router/sqs-stream-records.ts`).

Behaviour, for each `order` image (the record's new image; #284 has no refund record, so the order is the only input):

- **Is it a sale?** Only when `status` is `paid`, or `refunded` with `refundReason` `requested`, and `amount` is above 0. Everything else is skipped: `pending` and `expired` orders, a fully discounted order, and an order refunded automatically as undeliverable (`duplicate`, `unavailable`, `mismatch`), which carries `paidAt` but was never a sale.
- **Record the sale.** Read the course's `courseInstructor` records and call `recordSale` with the image and the stage's fee and hold. It is idempotent: a sale already recorded changes nothing. A course with no instructors records nothing and logs an error (`course-has-instructor` forbids it).
- **Record refunds up to the image's total.** If the image's `refundedAmount` is above 0, call `recordRefund` with that total and the time it happened (`refundedAt` on a `refunded` order, otherwise the image's `updatedAt`). `recordRefund` reads `earningOrder.refundedMinor` (R0). A total at or below R0 is a no-op. Otherwise it writes the refund entries for share(total) minus share(R0), raises `refundedMinor` to the total with the condition that it still equals R0, and retries the read-compute-write up to 5 times if another refund was recorded first.
- Delivery is at least once and in no guaranteed order (the router spec's handler obligations, its FR-011), and the handler is safe under both, because every image of a sale carries all it needs:
  - A duplicate or redelivered image finds the sale recorded and its refunded total already reached.
  - An older image delivered after a newer one finds a higher `refundedMinor` and records nothing.
  - A newer image delivered first records the sale and the whole refunded total as one entry; the older image is then a no-op. The ledger's total always catches up with the order's, though two refunds seen out of order may be recorded as one entry dated by the later one.
  - No record ever has to wait for another, so nothing relies on redelivery for ordering. The handler's header comment says this.
- Failures: the handler applies every record it can, then throws if any failed (no `batchItemFailures`), so the queue redelivers the whole batch after its visibility timeout and the redelivery changes nothing already applied. After 5 receives the message moves to the `earnings-recording` failure queue and its alarm fires. Nothing is half-recorded: redriving the failure queue once the cause is fixed (`POST /router/redrive/earnings-recording` locally, the SQS redrive when deployed) records what is missing.
- Its writes are routed to no feature: `featuresFor` returns nothing for `earningEntry`, `earningDay` and `earningOrder` records (no feedback loop, the router spec's FR-015).

Environment: table name, `PLATFORM_FEE_BASIS_POINTS`, `PAYOUT_HOLD_DAYS` (from stage config, set by the router's stack; by the event runner locally). It never calls Stripe and has no grant on the Stripe secrets.

## `events-payout-run` (scheduled, daily)

Trigger: a daily EventBridge schedule rule (a timer in the local event runner, plus `POST /payout-run` on its port for tests).

Behaviour:

0. **Bind to the payment account.** Read `paymentConnection`. Unless it is `active`, end the run without sending (not an error: payments are not connected, or a change holds the lease). Read the Stripe key once and check with Stripe that it belongs to the connection's `accountId` and `mode`; if it does not (a key cached across a switch), read the key once more, and if it still differs throw without sending. The run uses that one client throughout. Every later step touches only payout accounts, entries and payouts of this payment account; those of another are left exactly as they are (research R-12).
1. **Recover unsettled payouts**, for every instructor whatever their account's state: list `collecting`, `releasing` and `pending` payouts (`payoutsByStatus`); skip any whose `attemptedAt` is newer than the 15-minute grace (another run may be working on it); claim each remaining one by a conditional update of `attemptedAt` (a run that loses the claim skips it). Then:
   - `collecting` or `releasing`: `releasePayout` (no transfer can exist for a payout that was never sealed, or that Stripe definitely rejected).
   - `pending`: list Stripe transfers by `transfer_group` = `payoutId`; if one exists, `markPayoutSent` with it and do not send again; otherwise create the transfer (step 4's call) and classify the outcome as below.
2. For each account from `byStatus` = `active` of this payment account: retrieve it from Stripe; if it is no longer active, store the new status and skip it.
3. Per currency, sum the instructor's open entries of this payment account whose `releaseAt` has passed. If the sum is below `PAYOUT_MINIMUM_MINOR` (including zero or negative), do nothing.
4. `createPayout`: create the `collecting` payout, attach the entries in batches of up to 99 (data-model.md "Lifecycle"), and seal it `pending`. If a batch loses an entry to another run, `releasePayout` and move on to the next instructor; the entries stay for a later run. Then create the Stripe transfer for the payout's `amountMinor` with `transfer_group` and metadata set to the payout ID and the payout ID as idempotency key, and classify the outcome:
   - success: `markPayoutSent` (stores the transfer ID);
   - a definite Stripe rejection (an invalid-request or permission error, for example an account that cannot receive transfers or a platform balance that is too low): `markPayoutFailed` (stores the reason, then releases the entries);
   - anything uncertain (an idempotency conflict from a request with the same key still in flight, a timeout or connection error, a 5xx, a rate limit, an authentication error): the payout stays `pending` for step 1 of a later run. An authentication error also ends the run, since no later call can succeed.

   A payout is never marked failed on an uncertain outcome.
5. One instructor's failure does not stop the others. The run throws at the end if any instructor failed unexpectedly (a Stripe rejection is not unexpected: it is a recorded Failed payout).

Running twice, or two runs at once, sends nothing twice: the second finds no open released entries, loses an entry's condition in a batch, or loses the recovery claim. A pending payout older than Stripe's idempotency window whose transfer already exists is marked sent, not resent. A run that dies while collecting or releasing leaves a payout that the next run releases; its entries are open again and nothing was sent.

Environment: table name, the Stripe key secret (read as checkout reads it, through `common-server-utils/stripe/secrets`, with `StripeSecrets.grantReadApiKey`), `PAYOUT_MINIMUM_MINOR`.
