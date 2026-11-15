# Contract: events handlers

## `events-earnings-recording` (DynamoDB stream handler)

Trigger: the core table's stream, filtered by `EARNINGS_STREAM_FILTERS` (core-table `helpers/earnings-stream.ts`, also used by the deployed event source mapping and the local event runner): a paid `order` record and a new `refund` record.

Behaviour:

- Paid order: read the course's `courseInstructor` records, call `recordSale` with the stage's fee. No instructors, or `paidMinor` of 0, records nothing.
- Refund: read the order's `earningOrder` (its fee, instructors and `refundedMinor`), then call `recordRefund`, which computes the share from the amount already recorded as refunded (not from refund timestamps), serialises per order with a condition on `earningOrder.refundedMinor` and retries the read-compute-write up to 5 times if another refund was recorded first. An order with no sale entries because it was free or unpaid is ignored without error.
- Both helpers are idempotent by entry key. A thrown error fails the batch so the stream retries. A refund that arrives before its paid order has been recorded (a paid order with no `earningOrder`) fails the batch and retries until the sale exists. Refunds may be processed in any order: the entries always sum to the sale's fee and amounts once the recorded total equals the amount paid.
- Its writes match none of the three stream filters.

Environment: table name, `PLATFORM_FEE_BASIS_POINTS`, `PAYOUT_HOLD_DAYS` (from stage config).

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
