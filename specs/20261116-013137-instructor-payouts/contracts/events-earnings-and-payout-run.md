# Contract: events handlers

## `events-earnings-recording` (DynamoDB stream handler)

Trigger: the core table's stream, filtered by `EARNINGS_STREAM_FILTERS` (core-table `helpers/earnings-stream.ts`, also used by the deployed event source mapping and the local event runner): a paid `order` record and a new `refund` record.

Behaviour:

- Paid order: read the course's `courseInstructor` records, call `recordSale` with the stage's fee. No instructors, or `paidMinor` of 0, records nothing.
- Refund: read the order, its refunds up to this one (by created time, then ID) and its sale entries' fee and instructors, then call `recordRefund` (cumulative share, capped). An order with no sale entries because it was free or unpaid is ignored without error.
- Both helpers are idempotent by entry key. A thrown error fails the batch so the stream retries. A refund that arrives before its paid order has been recorded fails the batch and retries until the sale exists.
- Its writes match none of the three stream filters.

Environment: table name, `PLATFORM_FEE_BASIS_POINTS`, `PAYOUT_HOLD_DAYS` (from stage config).

## `events-payout-run` (scheduled, daily)

Trigger: EventBridge Scheduler once a day (a timer in the local event runner, plus `POST /payout-run` on its port for tests).

Behaviour:

1. Re-send any `pending` payout left by an earlier crashed run, with its stored `payoutId` as Stripe's idempotency key.
2. For each account from `byStatus` = `active`: retrieve it from Stripe; if it is no longer active, store the new status and skip it.
3. Per currency, sum the instructor's open entries whose `releaseAt` has passed. If the sum is below `PAYOUT_MINIMUM_MINOR` (including zero or negative), do nothing.
4. `createPayout` (the pending payout and each entry's `payoutId` in one transaction), call Stripe's transfer with the payout ID as idempotency key, then `markPayoutSent` (stores the transfer ID) or `markPayoutFailed` (stores the reason, clears the entries' `payoutId`, restoring their open key).
5. One instructor's failure does not stop the others. The run throws at the end if any instructor failed unexpectedly (a Stripe rejection is not unexpected: it is a recorded Failed payout).

Running twice, or two runs at once, sends nothing twice: the second finds no open released entries, or loses the payout transaction's condition.

Environment: table name, Stripe secret reference, `PAYOUT_MINIMUM_MINOR`.
