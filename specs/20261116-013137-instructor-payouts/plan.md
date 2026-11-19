# Implementation Plan: Instructor Revenue Reporting and Payouts

**Branch**: `spec/instructor-payouts` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261116-013137-instructor-payouts/spec.md`

## Summary

A new feature of the core table's stream router, `earnings-recording`, turns each paid order, and each rise in an order's refunded total, into immutable ledger entries per instructor (`earningEntry`), written with one `core-table` helper that, in one transaction, also adds the entry's figures to a per-day summary (`earningDay`). The fee, the equal split and the refund share come from one pure helper, `revenue.ts`. instructor-api gains an `earnings` router (period report from the day summaries, paged per-course lines from the ledger) and a `payout` router (Connect Express onboarding, status, dashboard link, balances and payouts). A daily scheduled Lambda (`payout-run`) sends each active instructor's released balance to their Stripe account as one transfer tagged with the payout's ID (as idempotency key and `transfer_group`), and recovers uncertain sends by looking the transfer up rather than trusting the key. Stripe is called with the key an administrator saved (#284), and money only moves inside the payment account (Stripe account and mode) that took the orders. The instructor portal gets an Earnings page. Stage config gains the fee, hold days and minimum payout.

What the existing code and the sibling specs showed that the spec could not:

1. **The order is the only input, and it has no refund record.** #284's spec and core-table code are on `main`: a refund raises the order's cumulative `refundedAmount`, `paidAt` is also set on payments refunded automatically as undeliverable, and disputes are handled by hand. So refunds are recorded up to a total, a sale is defined by `status` and `refundReason`, and disputes are out of scope (research R-5, R-9, R-13). The plan reads the order only at two seams, `EARNINGS_STREAM_FILTERS` and `earnings-from-order.ts`.
2. **One GSI exists** (`gsi1pk-gsi1sk-index`, shared by every entity), so every new access pattern must fit it or the primary key (research R-4).
3. **Money events must not live in the learner's request.** Recording as a feature registered with the table's stream router (`STREAM_FEATURES`), as progress, search, analytics and notification delivery already are, keeps checkout free of payout logic and makes each record a retriable, idempotent side effect with its own queue and failure queue (R-2).
4. **Account status is pulled, not pushed.** A signed webhook endpoint from Connect would add a second public route and secret; refreshing from Stripe when the instructor looks, and before each payout, is enough for a first slice (R-6). This amends FR-011 (spec updated in this PR).
5. **Money is not clawed back from Stripe in this slice.** A refund after a transfer becomes a negative open entry that nets against the next payout (R-7). This amends FR-014 (spec updated in this PR).
6. **The Stripe key is a run-time setting and the account can change.** #284 lets an administrator connect, rotate and switch the Stripe account. Express accounts and transfers belong to one account in one mode, so every earning, payout account and payout carries its order's payment account, `order` gains `mode`, and the run pays only inside the connection's current payment account (R-12, FR-023).
7. **A payout cannot be one transaction.** DynamoDB allows 100 items per transaction and a busy instructor has more released entries than that, so a payout collects its entries in batches and is sealed before any transfer (R-7).

## Technical Context

**Language/Version**: TypeScript (Node 22 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC + zod, ElectroDB (`@discava/core-table`), the Stripe SDK through `@discava/common-server-utils/stripe` (#284's client, key reading and local stand-in switch), TanStack Router/Query, shadcn (`@discava/common-shadcn`)

**Storage**: the one core table; new entities `payoutAccount`, `earningEntry`, `earningDay`, `earningOrder`, `payout`; no new index

**Testing**: vitest per project (with the `@discava/core-table` alias), core-table `helpers/invariants/`, instructor portal component tests, Playwright e2e in `packages/e2e` including `src/concurrency/`

**Target Platform**: AWS Lambda + API Gateway + CloudFront + an EventBridge schedule rule; `pnpm dev` with Docker locally

**Project Type**: web application: serverless backend + React portals

**Performance Goals**: a paid order in the report within 30 s (the router's hop, the feature's 5-second batch window and the handler); a period report in under 3 s regardless of order count (a bounded query over day summaries, at most 366 days x the instructor's courses)

**Constraints**: no second table; no scans in user requests; amounts are integers in minor units; Discava never stores bank or identity data; only instructor-api and the payout run get a read grant on the Stripe key, and the recording Lambda gets none; the only change to checkout's code is `startOrder` writing `order.mode`

**Scale/Scope**: one ledger entry per sale per instructor, plus one per recorded refund; one summary row per instructor, course, currency and day with activity

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | Lambda, the core table's stream router (one stream reader, an SQS queue per feature), an EventBridge schedule rule, API Gateway, Secrets Manager. Stripe is an external payment provider the issue itself names; no pluggable payment backend is added (R-1) |
| II. Generators first | Pass | The two new Lambdas (`events-earnings-recording`, `events-payout-run`) are created with the `ts#lambda-function` generator, as the other `events-*` wrappers are. The recording Lambda is wired in the router's stack (`stream-router-stack.ts`) and the payout run in the new Payouts stack. New code in core-table, instructor-api, instructor-portal and the stage config extends existing generated projects. The plan's first task confirms the generator via the MCP server |
| III. Everything runs locally | Pass, with one justified exception | Recording and the payout run run under the local event runner: recording is a registered feature, so the runner's router sends it records through its own ElasticMQ queue with no wiring of its own, and a timer triggers the run. Stripe is not an AWS service: Connect calls go to the local Stripe stand-in #284 provides (`events/src/local/stripe-stand-in.ts`), extended with Express accounts, account links, login links and transfers. Real Stripe behaviour (hosted onboarding, transfer settlement) is checked only on a deployed stage in test mode, as `(human)` tasks |
| IV. Layered tests | Pass, planned | Unit tests for `revenue.ts`, the helpers, procedures, Lambdas and the portal; new invariants and breaking tests; e2e scenarios; a concurrency test. Impact check below |
| V. Single-table via ElectroDB | Pass | Five entities, every access pattern keyed or on the existing GSI ([data-model.md](./data-model.md)); no scan in a user request; the scheduled run's queries (active accounts, unsettled payouts, open entries) use the GSI, not a scan. Earnings recording reacts to the table by registering in `STREAM_FEATURES` (constitution v1.2.1), not by reading the stream itself, and the registry's routing is checked for the new records (below) |
| VI. Secure by default | Pass | Procedures read only `ctx.user.sub`'s partition; the Stripe key stays in #284's secret, with a read grant (`StripeSecrets.grantReadApiKey`) to only instructor-api and the payout run, and no write grant; the key is checked against the connection's account and mode before use (R-12); no relaxed default; stage config can only change fee, hold and minimum |
| VII. Change freely before launch | Pass | New records, routes and settings are added outright, and `order.mode` is required with no default; existing development orders are fixed by hand |
| VIII. Repo conventions | Pass | `core-table/src/helpers/revenue.ts`, `earning.ts`, `payout.ts` (one file per topic); text-only buttons on the Earnings page; docs in English only |

No violations, so Complexity Tracking is empty.

**Impact check (constitution IV).** Shared records the feature writes or reads in a new way:

| Record | Use | Existing invariants and tests that already cover it | What changes |
|--------|-----|------------------------------------------------------|--------------|
| `order` (from #284) | Read by the `earnings-recording` feature's handler. Written in one new way: `startOrder` sets the new required `mode` | `order-shape`, `order-account-known`, `paid-order-has-enrolment`, `enrolment-order-matches`, `checkout-window-covers-orders` (`invariants/payments.ts`), and `order.test.ts` | `order-shape` requires `mode`; `order-account-known` compares `mode` as it does `accountId`; both get a breaking test. New checks tie ledger entries to the order (`earning-matches-order`, `earning-refunds-capped`). No other order rule changes |
| `paymentConnection` (from #284) | Read only: the current payment account, by the payout run and the `payout` procedures | `payment-connection-shape` | None; not written |
| `courseInstructor` | Read: instructors of the course at payment time | `course-has-instructor` | None changed. The split is a snapshot; `earning-matches-order` checks the recorded shares add up, not that they match today's instructors |
| `course` | Read: titles for the report | `course-has-instructor`, `instructor-course-updated-at` | None; not written |
| `user` | Not read (the report shows no buyer; instructors are their own `sub`) | `instructor-has-user` | None |
| `earningEntry`, `earningDay`, `earningOrder`, `payout`, `payoutAccount` (new) | Written by the recording Lambda, the payout run and instructor-api onboarding | none yet | New checks: `earning-identity`, `earning-matches-order`, `earning-refunds-capped`, `earning-day-matches-entries`, `payout-matches-entries`, `payout-account-shape` |
| Stream features (`STREAM_FEATURES`) | A new registration, `earnings-recording`: `order` records are routed to it, and inserts, updates and removals of the five new entities are routed to no feature | `stream-features.test.ts` (unique names, handlers exist, filters name real entities and match a sample), `progress-stream.test.ts`, `search-stream.test.ts`, `analytics-stream.test.ts`, `notification-stream.test.ts`, `handlers.test.ts` | New `earnings-stream.test.ts`; `stream-features.test.ts` gains assertions that `featuresFor` sends ledger, summary, per-order, payout and account records to no feature (no feedback loop, FR-015) and sends order records to `earnings-recording`. No existing feature's filters change |

## Design Decisions (detail in [research.md](./research.md))

1. **Ledger plus daily summary, in one transaction.** A sale or refund creates an `earningEntry` (conditioned on its key not existing) and ADDs its figures to `earningDay` in the same `TransactWrite`. A repeat fails the condition and changes nothing, so entry and summary can never disagree and each event counts once (R-3). A per-order `earningOrder` record holds the fee and instructor snapshot and the refunded total already in the ledger, and refunds raise it with a condition so concurrent refunds of one order serialise.
2. **One pure revenue helper.** `calculateSale`, `splitAmount` and `calculateRefund` in `helpers/revenue.ts` own fee rounding, the equal split and the refund share. The split is applied to the gross, the amount paid and the fee (the discount share is derived), and a refund's shares are the difference between the shares of the order's new refunded total and of the total already recorded, serialised per order. So a full refund returns exactly the whole fee and each instructor's whole amount, whatever order records arrive in (R-5).
3. **Recording as a stream router feature, not from checkout.** Earnings recording registers an `earnings-recording` entry in core-table's `STREAM_FEATURES` (filters `EARNINGS_STREAM_FILTERS`, handler `events-earnings-recording`). The core table's stream keeps its one reader, the `StreamRouter`: the router copies each inserted or modified `order` record to the feature's queue, and the construct builds that queue, its failure queue, alarm and the queue's event source mapping from the entry. The handler calls `recordSale` / `recordRefund`. A failed batch is redelivered by the queue, up to 5 receives, then set aside in the failure queue for a redrive. Delivery is at least once and unordered, which the design tolerates without relying on redelivery: any image of a sale order is enough to record the sale and bring its refunded total up to date, a recorded sale is a no-op, and so is a total the ledger has already reached (R-2).
4. **Stripe Connect Express, separate charges and transfers, held then paid by a daily run.** Discava charges the student on the platform account (#284), and later transfers each instructor's released balance to their connected account as one transfer tagged with the payout's ID (idempotency key, `transfer_group` and metadata). The payout collects its entries in batches and is sealed before the transfer, because one transaction cannot hold them all. An uncertain send (timeout, 5xx, idempotency conflict) leaves the payout pending and is reconciled by listing transfers by group; a payout is marked failed only on a definite Stripe rejection (R-7). A manual, reporting-only first slice and destination charges were rejected (R-1).
5. **Pull account status.** instructor-api refreshes the account from Stripe on onboarding return, on page load and the payout run before sending. No webhook route (R-6).
6. **Refunds after sending net against the next payout.** A refund entry is open from its creation; the run sums released entries, and sends only a positive total at or above the minimum (R-7).
7. **Stage settings validated at build.** `payouts.platformFeeBasisPoints`, `holdDays`, `minimumPayoutMinor` in `stages.config.ts`, checked in the config's types and tests, passed to the two Lambdas as environment variables by the stacks that build them (R-8).
8. **Report from summaries, lines from the ledger.** `earnings.report` queries `earningDay` by day range; `earnings.lines` queries `earningEntry` by course and time with a cursor (R-4).
9. **One payment account at a time.** The run and the `payout` procedures read #284's connection, check the saved key against it, and work only on records of that Stripe account and mode. Earnings of a payment account the platform has left are shown as Held and never paid from another (R-12).
10. **Disputes are out of scope**, as they are in #284 (R-13).

## Project Structure

### Documentation (this feature)

```text
specs/20261116-013137-instructor-payouts/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── instructor-api-earnings.md
│   ├── instructor-api-payout.md
│   ├── events-earnings-and-payout-run.md
│   └── instructor-portal-ui.md
├── checklists/
│   ├── requirements.md
│   └── money-correctness.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/
├── common/infra-config/src/                  # stages.types.ts: payouts settings; stages.config.ts values (+ test)
├── databases/core-table/src/
│   ├── entities/{payout-account,earning-entry,earning-day,earning-order,payout}.ts   # new (+ index.ts, service.ts)
│   ├── entities/order.ts                     # + mode (written by startOrder in helpers/order.ts)
│   └── helpers/
│       ├── revenue.ts                        # calculateSale, splitAmount, calculateRefund (+ test)
│       ├── earning.ts                        # recordSale, recordRefund, period report and lines queries (+ test)
│       ├── payout.ts                         # createPayout, markPayoutSent/Failed, releasePayout, claimPayout (+ test)
│       ├── earnings-stream.ts                # EARNINGS_STREAM_FILTERS (+ test)
│       ├── stream-features.ts                # the `earnings-recording` registration (+ routing tests)
│       └── invariants/earnings.ts            # six new checks (+ breaking tests); snapshot.ts, index.ts, payments.ts
├── common/server-utils/src/stripe/payouts.ts # Connect calls on #284's client, bound to the connection's account and mode (+ test)
├── events/src/earnings/
│   ├── earnings-from-order.ts                # order image -> sale or not, revenue input, refunded total (the #284 seam) (+ test)
│   ├── earnings-recording.ts                 # the feature's handler, fed from its queue (+ test)
│   └── payout-run.ts                         # scheduled handler (+ test); local trigger in src/local/
├── events/src/router/handlers.ts             # `earnings-recording` added to HANDLERS (the local runner dispatches through it)
├── apis/instructor-api/src/
│   ├── procedures/earnings.ts                # report, lines (+ test)
│   ├── procedures/payout.ts                  # account, startOnboarding, dashboardLink, overview (+ test)
│   └── router.ts
├── common/constructs/src/app/lambda-functions/   # generator-created events-earnings-recording, events-payout-run
├── infra/src/stacks/stream-router-stack.ts   # the earnings-recording Lambda, passed to StreamRouter in `handlers` (+ test)
├── infra/src/stacks/payouts-stack.ts         # new stack: the payout-run Lambda, its grants and schedule (+ stage test)
├── events/src/local/stripe-stand-in.ts       # + Express accounts, account links, login links, transfers, test controls
├── websites/instructor-portal/src/routes/_authenticated/earnings/   # Earnings page (route.tsx, -components/, -route.test.tsx)
├── e2e/src/{scenarios/earnings.e2e.ts, concurrency/earnings-recording.e2e.ts, helpers/earnings.ts}
docs/src/content/docs/en/                     # guide: earnings and payouts; design/instructor-payouts.mdx; the feature's row in design/stream-event-router.mdx
```

**Structure Decision**: extend existing packages; the only new projects are two generator-created Lambda wrappers and one stack file. Earnings recording adds no stream source, queue or alarm of its own: those come from the `StreamRouter` construct once the feature is registered. Revenue rules live in `core-table/helpers` because both the events Lambdas and instructor-api need them (CLAUDE.md: shared by two or more writers goes in a shared helper). The Connect calls live in `common-server-utils/stripe/`, beside #284's client, because instructor-api and the payout run both make them. (`stripe/connect.ts` there is the administrator's "connect a key" code, not Stripe Connect, hence the file name `payouts.ts`.)

## Risks

- **R1: #285's order fields, or the rest of #284, land differently.** The design is written against #284's order entity as it is on `main`, isolated behind `earnings-from-order.ts` and `EARNINGS_STREAM_FILTERS`; T010 re-reads both when Phase 2 starts. #285's contract names the charged amount `totalAmount` where the entity has `amount`; the seam needs only `listAmount` and `amount`.
- **R2: a payout that stops halfway.** A payout is built over several transactions, so a run can die between them. Every stopping point is a state recovery knows how to finish (`collecting` and `releasing` are released, `pending` is looked up at Stripe), a transfer is only created after sealing, and `payout-matches-entries` checks no entry is left pointing at a missing payout (data-model.md "Lifecycle").
- **R3: transfers need platform balance, and a send can be uncertain.** The default hold of 14 days exceeds Stripe's settlement time, so funds are available; a definitely rejected transfer shows as Failed and retries next run, while an uncertain one (timeout, 5xx, idempotency conflict) stays pending and is reconciled by looking up the transfer by its group, never by trusting a 24-hour idempotency key (R-7).
- **R4: Stripe API drift between the stand-in and real Stripe.** Only the `(human)` deployed check catches it; the plan keeps the Stripe surface to four writes (create account, create account link, create login link, create transfer) and three reads (retrieve the platform account, retrieve a connected account, list transfers by group).
- **R5: negative balance of an instructor who never earns again.** The platform absorbs it; recorded as a known limit and visible in the instructor's balance.
- **R6: `earningDay` write contention.** Many sales of one course in a day add to one row. ADD is atomic, but two transactions touching the same row at the same moment can cancel one another. The registration caps the handler at `maxConcurrency` 2 (the mapping's minimum), which keeps that rare; a cancelled transaction fails its batch, the queue redelivers it, and the idempotent helpers apply only what is missing.
- **R7: a record that keeps failing leaves earnings unrecorded.** After 5 receives the message sits in the `earnings-recording` failure queue, its alarm fires, and the sale or refund is missing from the ledger and report until someone fixes the cause and redrives the queue. Redrive is safe at any time because recording is idempotent by entry key, and a `(human)` task checks the queue and a redrive on a deployed stage.
- **R8: the platform changes its Stripe account or mode with earnings unpaid.** Those earnings are Held and are not paid by Discava unless the administrator switches back (R-12). It is rare, visible to the instructor and the operator's to settle; the alternative, paying them from another account, is the one thing that must not happen.
- **R9: the administrator's key cannot use Connect.** #284's connection check does not test for it. Onboarding fails with a clear message and an error log, and a `(human)` task checks the key's permissions on a deployed stage.

## Complexity Tracking

*No constitution violations.*
