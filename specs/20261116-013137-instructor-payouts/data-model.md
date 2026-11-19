# Data Model: Instructor Revenue Reporting and Payouts

All entities live in the one core table, under `packages/databases/core-table/src/entities/`. All amounts are integers in minor units.

## Inputs from #284 and #285 (on `main`)

`order` (`entities/order.ts`, written only by `helpers/order.ts`) is the only input. There is no refund record: a refund raises the order's cumulative `refundedAmount`. The fields this feature reads:

| Order field | Used as |
|-------------|---------|
| `orderId`, `courseId` | the entries' order and course; `userId` (the buyer) is never copied |
| `listAmount` | gross |
| `amount` | amount paid (what Stripe charged). #285's contract calls this `totalAmount`; T010 confirms the name when #285's code lands |
| `listAmount - amount` | discount. Derived, so it needs none of #285's `discountAmount` or coupon fields |
| `currency` | the entries' currency, upper case as the order stores it |
| `status`, `refundReason` | which orders are sales (below) |
| `paidAt` | when the sale happened |
| `refundedAmount` | the total refunded so far; only grows, at most `amount` |
| `refundedAt`, `updatedAt` | when a refund happened: `refundedAt` on a `refunded` order, otherwise the `updatedAt` of the image that raised `refundedAmount` |
| `accountId` | the Stripe account that took the payment |
| `mode` (**added by this feature**, T036) | `test` or `live`: the connection's mode when the checkout started |

**Which orders are sales.** An order is a sale when its `status` is `paid`, or `refunded` with `refundReason` `requested` (it was paid, then refunded by an operator), and its `amount` is above 0. An order refunded automatically as undeliverable (`refundReason` `duplicate`, `unavailable` or `mismatch`) also carries `paidAt` but was never a sale: it records nothing, and neither do `pending` and `expired` orders or a fully discounted order (`amount` 0).

**Payment account.** Express accounts and the balance transfers are paid from belong to one Stripe platform account in one mode. `accountId` plus `mode` is called the *payment account* below. Every earning, payout account and payout carries the payment account of its order, and money only moves inside one payment account (research R-12). `order` gains `mode` because a test key and a live key of one Stripe account share an `accountId`, and test-mode sales must never be paid with live money.

## `order` (existing): `mode`

| Attribute | Type | Notes |
|-----------|------|-------|
| `mode` | `test` / `live`, required, read-only | the connection's `mode` when the checkout started, written by `startOrder` in the transaction that already reads the connection for `accountId` |

Required with no default (constitution VII): existing local and development orders are fixed by hand. `order-shape` gains "has a `mode`", and `order-account-known` compares `mode` as it compares `accountId`.

## `payoutAccount` (new)

One per instructor and payment account.

| Attribute | Type | Notes |
|-----------|------|-------|
| `instructorId` | string, required | Cognito `sub` |
| `accountId`, `mode` | string and `test` / `live`, required, read-only | the payment account the connected account was created under |
| `connectedAccountId` | string, required, read-only | the instructor's Express account |
| `status` | `in_progress` / `active` / `restricted`, required | refreshed from Stripe (R-6) |
| `createdAt`, `updatedAt` | as other entities | |

Keys: primary pk `instructorId`, sk `account#<accountId>#<mode>`. Index `byStatus` on `gsi1pk-gsi1sk-index`: `gsi1pk` = `<accountId>#<mode>#<status>`, `gsi1sk` = `instructorId` (lists the current payment account's active accounts for the daily run).

## `earningEntry` (new, immutable except `payoutId`)

One per sale per instructor (`kind` = `sale`), and one per recorded refund per instructor (`kind` = `refund`).

| Attribute | Type | Notes |
|-----------|------|-------|
| `instructorId`, `courseId`, `orderId` | string, required | |
| `accountId`, `mode` | required, read-only | the order's payment account |
| `entryId` | string, required | `sale-<orderId>`, or `refund-<orderId>-<refundedTotal>` where `refundedTotal` is the order's refunded total this entry brings the ledger up to. Recorded totals only grow, so the ID is unique per order |
| `kind` | `sale` / `refund`, required | |
| `currency` | string, required | as on the order (upper case) |
| `grossMinor`, `discountMinor` | integer >= 0 | the instructor's share; 0 on refund entries |
| `refundMinor` | integer >= 0 | the instructor's share of the amount refunded; 0 on sale entries |
| `feeMinor` | integer | share of the platform fee; zero or negative on refund entries (fee returned) |
| `netMinor` | integer | signed: `gross - discount - refund - fee` |
| `feeBasisPoints` | integer, required | the fee in effect when the sale was recorded; copied to refund entries from the sale |
| `occurredAt` | ISO string, required | sale: the order's `paidAt`. Refund: the order's `refundedAt`, or the `updatedAt` of the order image that raised `refundedAmount`. Never "now" |
| `releaseAt` | ISO string, required | sale: `occurredAt` + hold days; refund: `occurredAt` |
| `payoutId` | string, optional | the payout that took the entry; set and cleared only by `helpers/payout.ts` |
| `createdAt` | as other entities | |

Keys: primary pk `instructorId`, sk `L#<courseId>#<occurredAt>#<entryId>` (a course's lines in time order, one range query). Index `bySettlement` on `gsi1pk-gsi1sk-index`: `gsi1pk` = `open#<instructorId>` while `payoutId` is unset and `payout#<payoutId>` once it is set, `gsi1sk` = `<releaseAt>#<entryId>`. One index answers both "an instructor's open entries" and "a payout's entries", and the key only ever changes value, so nothing depends on removing an index key (R-4).

A refund's share can be zero in every figure for one instructor (a refund of one minor unit of an order shared by two). That instructor gets no entry for it.

## `earningOrder` (new, one per sale)

Created by `recordSale` in the same transaction as the order's entries; updated only by `recordRefund`. It is the snapshot refunds are computed from and the per-order counter that serialises them (research R-3, R-5).

| Attribute | Type | Notes |
|-----------|------|-------|
| `orderId`, `courseId`, `currency`, `accountId`, `mode` | required, read-only | from the order |
| `grossMinor`, `discountMinor`, `paidMinor`, `feeMinor` | integer, required, read-only | the order's figures and the total fee (round-half-up of `paidMinor` x `feeBasisPoints` / 10000) |
| `feeBasisPoints` | integer, required, read-only | the fee in effect when the sale was recorded |
| `instructorIds` | list of strings, required, read-only | the split recipients, sorted ascending, as they were when the sale was recorded |
| `refundedMinor` | integer, required | the refunded total already in the ledger; starts at 0, at most `paidMinor`, only increases |
| `createdAt`, `updatedAt` | as other entities | |

Keys: primary pk `orderId`, sk constant `earning`. No index.

## `earningDay` (new, maintained by `recordSale` / `recordRefund`)

One row per instructor, course, currency and UTC day with activity.

| Attribute | Type | Notes |
|-----------|------|-------|
| `instructorId`, `courseId`, `currency`, `day` | string, required | `day` = `YYYY-MM-DD` of the entry's `occurredAt` |
| `salesCount` | integer | sales that day |
| `grossMinor`, `discountMinor`, `refundMinor` | integer | sums of the entries |
| `feeMinor` | integer | net fee: sale fees minus fees returned |
| `netMinor` | integer | `gross - discount - refund - fee` |

Keys: primary pk `instructorId`, sk `D#<day>#<courseId>#<currency>` (a day range is one query). Written only by ADD inside the entry transaction. The report covers every payment account (it is a record of sales, not of what can be paid), so the row is not split by payment account.

## `payout` (new)

| Attribute | Type | Notes |
|-----------|------|-------|
| `instructorId`, `payoutId` | string, required | `payoutId` is a UUIDv7; also Stripe's idempotency key and the `transfer_group` and metadata of its transfer, so a transfer can be found from the payout |
| `accountId`, `mode` | required, read-only | the payment account it is paid from; its entries all carry the same one |
| `currency` | string, required | one payout per instructor, payment account and currency |
| `status` | `collecting` / `pending` / `sent` / `failed` / `releasing`, required | lifecycle below |
| `amountMinor` | integer, required | the net sum of the entries attached so far; above 0 from `pending` on. Kept as the amount attempted once `failed` |
| `entryCount` | integer, required | entries attached so far |
| `attemptedAt` | ISO string, required | when a run last worked on it (set at creation; moved by the recovery claim, conditioned on its old value, so overlapping runs cannot both act on it) |
| `connectedAccountId` | string, required | the destination, copied from the payout account |
| `transferId` | string, optional | set when `sent` |
| `failureReason` | string, optional | set when Stripe definitely rejected the transfer |
| `createdAt`, `updatedAt`, `settledAt` | ISO strings | |

Keys: primary pk `instructorId`, sk `P#<createdAt>#<payoutId>` (an instructor's payouts in time order, one query). Index `payoutsByStatus` on `gsi1pk-gsi1sk-index`: `gsi1pk` = `status`, `gsi1sk` = `payoutId`. Recovery reads its `collecting`, `releasing` and `pending` partitions, for every instructor whatever their account's state; those partitions are small because a payout leaves them when it settles. A payout's entries are found by `bySettlement` (`payout#<payoutId>`).

**Lifecycle.** A DynamoDB transaction holds at most 100 items, and an instructor can have more released entries than that, so a payout is not created in one transaction. It collects its entries in batches, and no transfer is made until it is sealed:

```text
collecting ──every batch attached──► pending ──transfer exists──► sent
     │                                  └─Stripe definitely rejects──► releasing ──entries cleared──► failed
     └─a batch lost an entry, or the run died──► releasing ──entries cleared──► (deleted)
```

- `collecting`: each batch is one transaction that sets `payoutId` on up to 99 entries (each conditioned on having none) and ADDs their net and count to the payout (conditioned on `status = collecting`). So the payout's amount always equals its entries' sum, and an entry can never be in two payouts.
- `pending`: sealed (conditioned on `collecting`); only now may a transfer be created, for `amountMinor`.
- `releasing`: the payout will not be paid. Its entries' `payoutId` are cleared in batches of up to 100; a batch transaction can no longer attach to it. When none are left it becomes `failed` if it has a `failureReason` (a rejected transfer, shown to the instructor), otherwise the record is deleted (it never got as far as a transfer).
- `sent` and `failed` are final.

## Statuses the Earnings page shows (derived, not stored)

| Shown | When |
|-------|------|
| On hold | open sale entry of the current payment account, `releaseAt` in the future |
| Waiting for account setup | released open entries of the current payment account and no active payout account |
| Ready | released open entries of the current payment account, active account, not yet sent (or below the minimum) |
| Held | open entries of a payment account the platform no longer uses (R-12) |
| Pending | entry's payout is `collecting` or `pending` |
| Sent | entry's payout is `sent` |
| Failed | the latest payout is `failed` (its entries are open again; the failure reason is shown until a later run succeeds) |

## Access patterns (constitution V)

| Pattern | Key | Used by |
|---------|-----|---------|
| Report: an instructor's days in a range | primary query on pk `instructorId`, sk range `D#<from>` to `D#<to>~` | `earnings.report` |
| Lines for a course in a period | primary query pk `instructorId`, sk range under `L#<courseId>#` | `earnings.lines` |
| An instructor's payouts | primary query sk prefix `P#` | `payout.overview` |
| An instructor's payout account for a payment account | primary get | `payout.account`, `startOnboarding`, the run |
| Active accounts of the current payment account | `payoutAccount` `byStatus` | `payout-run` |
| Unsettled payouts to recover, any instructor | `payout` `payoutsByStatus` (`collecting`, `releasing`, `pending`; payment account and `attemptedAt` filtered in code) | `payout-run` |
| An order's earnings snapshot and refunded counter | `earningOrder` primary get | `recordSale`, `recordRefund` |
| Open entries for an instructor | `bySettlement`, `open#<instructorId>` (payment account filtered in code) | `payout-run`, `payout.overview` |
| A payout's entries | `bySettlement`, `payout#<payoutId>` | releasing a payout, invariants |
| Instructors of a course | `courseInstructor` primary query (existing) | `recordSale` |
| The payment connection | `paymentConnection` primary get (existing) | `payout-run`, the `payout` procedures |

No scans.

## Stream routing (`STREAM_FEATURES`)

One new registration, `earnings-recording` (filters `EARNINGS_STREAM_FILTERS`; contract in [contracts/events-earnings-and-payout-run.md](./contracts/events-earnings-and-payout-run.md)). `featuresFor` routes an inserted or modified `order` to it. Inserts, updates and removals of `earningEntry`, `earningDay`, `earningOrder`, `payout` and `payoutAccount` are routed to no feature, so no handler's own writes come back to it. No existing feature's filters change.

## Rules and where they live

- `helpers/revenue.ts` (pure): `calculateSale({ grossMinor, paidMinor, feeBasisPoints, instructorIds })` returns each instructor's gross, discount, fee and net; `calculateRefund({ sale inputs, recordedRefundedMinor, refundedTotalMinor })` returns each instructor's refund share, fee returned and net for share(new total, capped at the amount paid) minus share(recorded), where `recordedRefundedMinor` is `earningOrder.refundedMinor`. The split rule is in research R-5.
- `helpers/earning.ts`: the only writer of `earningEntry`, `earningDay` and `earningOrder` (`recordSale`, `recordRefund`, which serialises refunds per order with a condition on `earningOrder.refundedMinor`), and the readers for the report and lines.
- `helpers/payout.ts`: the only writer of `payout` and `payoutAccount`, and the only code that sets or clears an entry's `payoutId`: `createPayout` (collect, then seal), `markPayoutSent`, `markPayoutFailed` (to `releasing` with the reason, then release), `releasePayout` (finishes a `collecting` or `releasing` payout), `claimPayout`, `saveAccountStatus`.
- `helpers/order.ts` (existing): `startOrder` also writes `mode`.

Verb-named helpers run their own I/O (core-table's naming rule). After any task changes which code writes the core table, `core-table/entity-writers.json` is regenerated (`pnpm nx run @discava/common-scripts:entity-writers`), or the `Invariant coverage` PR check fails.

## Invariants (`helpers/invariants/earnings.ts`; `snapshot.ts` gains the new entities)

Every check runs from the ledger towards the order, never the other way: recording is asynchronous, so "a paid order has no entries yet" is not a violation, and a check that said so would fail any test that looked before the queue drained.

- `earning-identity`: every entry's amounts are integers, `net = gross - discount - refund - fee`, sale entries have `refund = 0` and refund entries have `gross = discount = 0` and `fee <= 0`.
- `earning-matches-order`: each `earningOrder` has an order that is a sale (rule above), with the same course, currency, `accountId` and `mode`, `grossMinor` = `listAmount`, `paidMinor` = `amount`, and `feeMinor` the rounded fee at its `feeBasisPoints`. Its sale entries are exactly one per `instructorIds` member; their gross sums to `grossMinor`, `gross - discount` to `paidMinor` and fee to `feeMinor`; each carries the order's course, currency and payment account. No entry exists without its `earningOrder`.
- `earning-refunds-capped`: per order, refund entries' `refundMinor` sum to `earningOrder.refundedMinor`, which is at most `paidMinor` and at most the order's `refundedAmount`; each instructor's refund fee and net never exceed their sale entry's; once `refundedMinor` equals `paidMinor`, each instructor's refund fee and net equal their sale entry's exactly (a full refund nets to zero).
- `earning-day-matches-entries`: each `earningDay` row equals the sum of its entries (count, gross, discount, refund, fee, net), and every entry has a row.
- `payout-matches-entries`: an entry's `payoutId` names an existing payout of the same instructor, currency and payment account, and its `bySettlement` key agrees with it; a `collecting`, `pending` or `sent` payout's `amountMinor` and `entryCount` equal its entries' net sum and number; a `pending` or `sent` payout's amount is above 0; a transfer ID is present exactly when `sent`; a `failed` payout has a reason and no entries.
- `payout-account-shape`: at most one account per instructor and payment account, status in the allowed set, the instructor has a user record.

Each ships with a test that breaks it. Existing invariants stay as they are, except `order-shape` and `order-account-known`, which gain `mode`; `activity-count-matches-students` and the `student-records-*` checks do not include these entities, and a test pins that.
