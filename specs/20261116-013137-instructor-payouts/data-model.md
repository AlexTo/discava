# Data Model: Instructor Revenue Reporting and Payouts

All entities live in the one core table, under `packages/databases/core-table/src/entities/`. All amounts are integers in minor units. Assumed inputs from #284 are marked (assumed).

## Assumed inputs (from #284 and #285)

- `order` (assumed): `orderId`, `userId` (buyer), `courseId`, `currency`, `grossMinor` (list price), `discountMinor`, `paidMinor` (= gross - discount), `status`, `paidAt`.
- `refund` (assumed): `refundId`, `orderId`, `amountMinor`, `createdAt`, `reason` (`refund` or `dispute`); queryable by `orderId`.

## `payoutAccount` (new)

| Attribute | Type | Notes |
|-----------|------|-------|
| `instructorId` | string, required | Cognito `sub` |
| `stripeAccountId` | string, required, read-only | the connected account |
| `status` | `in_progress` / `active` / `restricted`, required | refreshed from Stripe (R-6) |
| `createdAt`, `updatedAt` | as other entities | |

Keys: primary pk `instructorId`, sk constant `account`. Index `byStatus` on `gsi1pk-gsi1sk-index`: `gsi1pk` = `status`, `gsi1sk` = `instructorId` (lists active accounts for the daily run).

## `earningEntry` (new, immutable except `payoutId`)

One per order per instructor (`kind` = `sale`) and one per refund per instructor (`kind` = `refund`).

| Attribute | Type | Notes |
|-----------|------|-------|
| `instructorId`, `courseId`, `orderId` | string, required | |
| `entryId` | string, required | `sale-<orderId>` or `refund-<refundId>` |
| `kind` | `sale` / `refund`, required | |
| `currency` | string, required | lower-case ISO code |
| `grossMinor`, `discountMinor` | integer >= 0 | the instructor's share; 0 on refund entries |
| `refundMinor` | integer >= 0 | the instructor's share of the amount refunded; 0 on sale entries |
| `feeMinor` | integer | share of the platform fee; negative on refund entries (fee returned) |
| `netMinor` | integer | signed: `gross - discount - refund - fee` |
| `feeBasisPoints` | integer, required | the fee in effect when the sale was recorded; copied to refund entries from the sale |
| `occurredAt` | ISO string, required | order's `paidAt` or refund's `createdAt` (stable across retries) |
| `releaseAt` | ISO string, required | sale: `occurredAt` + hold days; refund: `occurredAt` |
| `payoutId` | string, optional | set once, in the transaction that creates the payout |
| `createdAt` | as other entities | |

Keys: primary pk `instructorId`, sk `L#<courseId>#<occurredAt>#<entryId>` (a course's lines in time order, one range query). Index `byOpen` on `gsi1pk-gsi1sk-index`: `gsi1pk` = `open#<instructorId>`, `gsi1sk` = `<releaseAt>#<entryId>`, present only while `payoutId` is unset (sparse; R-4).

## `earningDay` (new, maintained by `recordSale` / `recordRefund`)

One row per instructor, course, currency and UTC day with activity.

| Attribute | Type | Notes |
|-----------|------|-------|
| `instructorId`, `courseId`, `currency`, `day` | string, required | `day` = `YYYY-MM-DD` |
| `salesCount` | integer | paid orders that day |
| `grossMinor`, `discountMinor`, `refundMinor` | integer | sums of the entries |
| `feeMinor` | integer | net fee: sale fees minus fees returned |
| `netMinor` | integer | `gross - discount - refund - fee` |

Keys: primary pk `instructorId`, sk `D#<day>#<courseId>#<currency>` (a day range is one query). Written only by ADD inside the entry transaction.

## `payout` (new)

| Attribute | Type | Notes |
|-----------|------|-------|
| `instructorId`, `payoutId` | string, required | `payoutId` is a UUIDv7; also Stripe's idempotency key |
| `currency` | string, required | one payout per instructor and currency |
| `amountMinor` | integer > 0, required | sum of the entries |
| `status` | `pending` / `sent` / `failed`, required | |
| `stripeTransferId` | string, optional | set when `sent` |
| `failureReason` | string, optional | set when `failed` |
| `createdAt`, `updatedAt`, `settledAt` | ISO strings | |

Keys: primary pk `instructorId`, sk `P#<createdAt>#<payoutId>` (an instructor's payouts, newest last, one query). A payout's entries are those with its `payoutId`: found through the primary key range of the instructor (invariant tooling only) and carried as `entryKeys` (list of entry sort keys) on the payout for the settlement transaction.

## Statuses the Earnings page shows (derived, not stored)

| Shown | When |
|-------|------|
| On hold | open sale entry, `releaseAt` in the future |
| Waiting for account setup | released open entries and no active account |
| Ready | released open entries, active account, not yet sent (or below the minimum) |
| Sent | entry's payout is `sent` |
| Failed | the latest payout is `failed` (its entries are open again; the failure reason is shown until a later run succeeds) |

## Access patterns (constitution V)

| Pattern | Key | Used by |
|---------|-----|---------|
| Report: an instructor's days in a range | primary query on pk `instructorId`, sk range `D#<from>` to `D#<to>~` | `earnings.report` |
| Lines for a course in a period | primary query pk `instructorId`, sk range under `L#<courseId>#` | `earnings.lines` |
| An instructor's payouts | primary query sk prefix `P#` | `payout.overview` |
| An instructor's payout account | primary get | `payout.account`, `startOnboarding`, the run |
| Active accounts for the run | `byStatus` | `payout-run` |
| Open entries for an instructor | `byOpen` | `payout-run`, `payout.overview` |
| Refunds of an order, instructors of a course | `refund`/`courseInstructor` keys (existing or #284) | `recordRefund`, `recordSale` |

No scans. Ledger, summary, payout and account records match none of `PROGRESS_STREAM_FILTERS`, `SEARCH_STREAM_FILTERS` or `EARNINGS_STREAM_FILTERS`.

## Rules and where they live

- `helpers/revenue.ts` (pure): `calculateSale({ grossMinor, discountMinor, feeBasisPoints, instructorIds })` returns each instructor's gross, discount, fee, net; `calculateRefund({ sale inputs, refundedBeforeMinor, refundMinor })` returns each instructor's refund share, fee returned and net, capped at the amount paid.
- `helpers/earning.ts`: the only writer of `earningEntry` and `earningDay` (`recordSale`, `recordRefund`), and the readers for the report and lines.
- `helpers/payout.ts`: the only writer of `payout`, and the only code that sets or clears an entry's `payoutId` (`createPayout` creates the pending payout and sets each entry's `payoutId` in one transaction; `markPayoutFailed` clears them in one).
- Account writes go through `helpers/payout.ts` too (`saveAccountStatus`).

## Invariants (`helpers/invariants.ts`, snapshot gains the four entities)

- `earning-identity`: every entry's amounts are integers, `net = gross - discount - refund - fee`, sale entries have `refund = 0` and refund entries have `gross = discount = 0` and `fee <= 0`.
- `earning-matches-order`: for each order with sale entries, the entries' `gross - discount` sum to the order's `paidMinor`, gross to `grossMinor`, and fees to the rounded fee at the entry's `feeBasisPoints`; each entry's course and currency match the order.
- `earning-refunds-capped`: per order, refund entries' `refundMinor` sum to at most the amount paid, and each refund entry matches a refund record.
- `earning-day-matches-entries`: each `earningDay` row equals the sum of its entries (count, gross, discount, refund, fee, net), and every entry has a row.
- `payout-matches-entries`: each entry has at most one payout; open entries have no `payoutId` and carry the `byOpen` key; each non-failed payout's `amountMinor` equals its entries' net sum; a `sent` payout has a transfer ID and a `failed` one has none of its entries.
- `payout-account-shape`: one account per instructor, status in the allowed set, instructor has a user record.

Each ships with a test that breaks it. Existing invariants stay as they are; `activity-count-matches-students` and the `student-records-*` checks do not include these entities, and a test pins that.
