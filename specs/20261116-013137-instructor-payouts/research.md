# Research: Instructor Revenue Reporting and Payouts

## R-1: Payout mechanism

**Decision**: Stripe Connect Express accounts. The platform charges the student on its own Stripe account (as #284 does), records instructor earnings in its own ledger, and, after a hold period, sends each instructor's released balance to their connected account as a Stripe transfer. Stripe pays the instructor's bank on its own schedule. Discava shows its own transfer status and links to the Express dashboard for the rest.

**Rationale**:

- The issue names Stripe Connect onboarding, and Express keeps identity, bank details and tax forms in Stripe's hosted flow, so Discava stores none of it (FR-010).
- Separate charges and transfers fit a course taught by several instructors (equal split, FR split rule): one charge, several transfers. Destination charges pay one connected account per charge.
- Holding the money on the platform until the hold period ends makes refunds cheap: most refunds arrive before anything was sent, so nothing needs reversing.
- A ledger of our own is what makes "totals reconcile with orders and refunds" provable by invariants, independent of Stripe's reports.
- It runs on Lambda, DynamoDB and EventBridge Scheduler, so it respects the serverless, AWS-only stance. Stripe is a service call, not a pluggable backend.

**Alternatives**:

- *Reporting-only first slice (manual payouts by the operator)*: simplest and avoids Connect, but the issue asks for onboarding and payout status, and manual bank transfers do not scale or reconcile. The ledger built here is the same thing a manual process would need, so reporting is Phase 3 and the money-moving phases (4 and 5) can be dropped or deferred by the maintainer without wasting the rest.
- *Destination charges with `application_fee_amount`*: Stripe splits at charge time, so there is no hold or ledger to run. Rejected: one destination per charge breaks multi-instructor courses, refunds must reverse transfers on Stripe's side, and the platform would depend on Stripe's reports for reconciliation.
- *Standard or Custom accounts*: Standard sends instructors through full Stripe accounts and hands the platform less control; Custom makes Discava responsible for onboarding UI and compliance. Rejected as worse fits for an opinionated, small platform.

## R-2: Where earnings are recorded

**Decision**: Earnings recording is a feature of the core table's stream router. It adds an `earnings-recording` entry to `STREAM_FEATURES` (core-table `helpers/stream-features.ts`): filters `EARNINGS_STREAM_FILTERS` (an inserted or modified `order`, an inserted `refund`), handler `events-earnings-recording`, batch 100 records / 5 s, `maxReceiveCount` 5, `maxConcurrency` 2. The table's stream keeps its one reader, the `StreamRouter`; the construct builds the feature's queue, failure queue, alarm and mapping from the entry, and the local event runner builds the same from it over ElasticMQ. The handler calls `recordSale` / `recordRefund`.

**Rationale**: checkout stays free of payout logic. Constitution v1.2.1 (principle V) and CLAUDE.md require a feature to register in `STREAM_FEATURES` and not attach its own stream source, so the stream stays at one reader. The router delivers at least once and in no guaranteed order, and the design already tolerates both. The helpers are idempotent by entry key, so a redelivered or duplicated record changes nothing, which is the property the spec's SC-002 asks for. Refund shares come from `earningOrder.refundedMinor` in recording order, not from the order records arrive in (R-5). A refund that arrives before its sale throws and is redelivered; within one batch the handler applies order records before refund records, so the two arriving together succeed the first time. A batch that fails is redelivered by the queue after its visibility timeout; after 5 receives the message goes to the feature's own failure queue, whose alarm fires, and a redrive replays it once the cause is fixed (`POST /router/redrive/earnings-recording` locally, the SQS redrive when deployed). The concurrency cap of 2 is for the `earningDay` row that sales of one course share (plan risk R6).

**Alternatives**: a table-stream event source mapping of its own (the first draft of this spec; main's stream router exists to prevent a further stream reader, and the registration gets retries, a failure queue and an alarm without building them); recording inside #284's webhook handler (couples the two features and a payout bug could fail a payment confirmation); a transaction with the order write (the order writer would need to know instructors and fee).

## R-3: Entry and summary written together

**Decision**: `recordSale` and `recordRefund` use one DynamoDB transaction: Put the `earningEntry` with a condition that its key does not exist, and Update (ADD) the matching `earningDay` row. If the condition fails, the transaction cancels and the helper returns the existing entry. Refunds are also serialised per order: a per-order record, `earningOrder`, holds the amount already recorded as refunded, and a refund's transaction updates it with the condition that it still holds the value the refund's shares were computed from (R-5).

**Rationale**: the report reads summaries while the drill-down reads entries, so they must never disagree, and they cannot if one atomic write does both. An invariant (`earning-day-matches-entries`) backs it up.

**Alternatives**: computing the report from entries per request (cost grows with orders, breaking SC-004); summaries updated by a second stream feature (eventually consistent, a second feedback path to guard, and the report would lag the ledger).

## R-4: Access patterns on the single GSI

**Decision**: See [data-model.md](./data-model.md). Primary keys carry every pattern except two, which use `gsi1pk-gsi1sk-index`: the daily run lists active payout accounts (`gsi1pk` = account status, `gsi1sk` = instructor ID), and the run reads an instructor's open entries (`gsi1pk` = `open` plus instructor ID, `gsi1sk` = release time plus entry ID, present only while the entry is unpaid). Key prefixes ElectroDB adds keep entities apart, and a test using `.params()` proves it.

**Rationale**: constitution V: no scans and no new index without a named pattern; these two are the only patterns the primary key cannot serve. The run is a scheduled job, not a user request, but a keyed query is cheaper and safer than a scan anyway.

**Fallback**: if ElectroDB cannot remove an index key when an entry is settled (risk R2), keep a `payoutBalance` record per instructor and currency, updated in the same transaction as each entry and each payout, and drop the open-entries index.

## R-5: Rounding, split and refund shares

**Decision**: Amounts are integers in minor units. Fee = round-half-up of paid x basis points / 10000; instructor amount = paid - fee. Equal split among N instructors, sorted by instructor ID, with the remainder minor units given to the first ones one each (applied separately to gross, discount and fee, so each instructor's net is derived and the identity holds per entry). Refund entries use cumulative shares over what has already been *recorded*, in processing order: with R0 the amount `earningOrder` says is recorded as refunded and r this refund's amount (capped so R0 + r is at most the amount paid), the refund's share is share(R0 + r) minus share(R0), where share applies the same fee and split rules to a cumulative refunded amount. The read of R0 and the write are serialised per order by a condition on `earningOrder.refundedMinor = R0` inside the R-3 transaction; if it fails because another refund was recorded first, the helper re-reads and recomputes (up to 5 attempts, then throws so the stream batch retries), and if the refund's own entries already exist it returns them.

**Rationale**: the shares telescope in the order refunds are *recorded*, so once the recorded total equals the amount paid, the refund entries return exactly the whole fee and every instructor's whole amount, however many pieces and whatever order Stripe webhooks and stream records arrive in. Sorting by created time instead is not safe: it would need every refund to be processed in that order. Example: paid 2, fee 5000 bp so the sale fee is 1, two refunds of 1 processed in either order; the first returns round(1 x 1/2) = 1 of the fee and the second share(2) - share(1) = 1 - 1 = 0, so 1 is returned in total, never 2. A refund is idempotent by its entry keys, and the per-order condition makes a concurrent pair serialise rather than both reading the same R0.

**Alternatives**: proportional rounding per refund (accumulates cent errors, and a full refund in thirds would not net to zero); floating point (forbidden by FR-020).

## R-6: Account status: pull, not webhook

**Decision**: `payout.account` retrieves the connected account from Stripe and updates the stored status when the instructor opens the Earnings page and after returning from onboarding; the payout run retrieves it again before it sends. Mapping: no `details_submitted` = in progress; `payouts_enabled` and `charges`/requirements clear = active; otherwise restricted.

**Rationale**: a Connect webhook adds a public route, a second signing secret and a verification path to build, secure and run locally; the information is only needed when an instructor looks or before money moves, and both can fetch it live. Stripe also refuses a transfer to a restricted account, which shows as Failed and retries.

**Alternatives**: a signed Connect webhook (better freshness; a follow-up if instructors need to be notified of a restriction, which would fit the notifications spec #331).

## R-7: Hold, minimum, failures and refunds after sending

**Decision**: An entry is *released* once `releaseAt` (sale time + `holdDays`) has passed; refund entries release at once. The daily run, for each active account and currency, sums its open released entries, and sends one transfer only if the sum is at least `minimumPayoutMinor`. A sum at or below zero stays open (a refund after sending nets against future sales). A rejected transfer marks the payout Failed with Stripe's reason and returns its entries to open. The payout record exists (pending) before the Stripe call, and every transfer is created with `transfer_group` and metadata set to the payout ID, plus the payout ID as Stripe's idempotency key. Stripe may forget an idempotency key after about 24 hours, so the key alone is not enough to make a late retry safe. Recovery therefore works from the transfer itself: the daily run first looks at every `pending` payout (found by `payoutsByStatus`, whatever the instructor's account state) whose last attempt is older than a 15-minute grace period, claims it with a conditional update of `attemptedAt` (so two overlapping runs cannot both resend it), and lists transfers by `transfer_group` = payout ID. If one exists, it marks the payout sent with that transfer; only if none exists does it create one (same key and group). The outcome of a create is classified: success marks sent; a *definite rejection* from Stripe (a 4xx invalid-request or permission error, an account that cannot receive transfers) marks the payout failed and reopens its entries; anything *uncertain* (an idempotency conflict because another request with the same key is still in flight, a timeout or connection error, a 5xx, a rate limit) leaves the payout pending for the next run's recovery. A payout is never marked failed unless Stripe definitely refused it, because a transfer that went through must never have its entries reopened (SC-006).

**Rationale**: it keeps the run simple, retry-safe and free of Stripe-side clawbacks. Reversing transfers needs the connected account to hold the funds and adds failure paths we would test only on a deployed stage.

**Alternatives**: reversing transfers on refund (spec's original FR-014 "when possible": amended in this PR to deduction only; a follow-up can add reversals); instructor-requested payouts (out of scope).

## R-8: Stage settings

**Decision**: `payouts: { platformFeeBasisPoints, holdDays, minimumPayoutMinor }` in the stage types, with defaults documented in `stages.config.ts` comments (2000 bp = 20%, 14 days, 1000 minor units) and a unit test rejecting a fee outside 0 to 10000 and negative or non-integer days and minimums. Values reach the two Lambdas as environment variables set by the stacks that build them (the router's stack for recording, the Payouts stack for the run), from stack props. Fee in basis points avoids decimal percentages.

**Alternatives**: per-course or per-instructor fees (rejected in Clarifications); an AppConfig value (the stage config is the established place for deploy-time choices, and a fee should change by deploy, not by a console click).

## R-9: Seams to #284 and #285

**Decision**: Assume an `order` record (order ID, buyer, course, currency, gross, discount, amount paid, status, paid time) and a `refund` record (refund ID, order ID, amount, created time, reason `refund` or `dispute`), queryable by order. `earnings-from-order.ts` maps them into `revenue.ts` input (a refund is read together with the order's `earningOrder`, not its other refund records), and `EARNINGS_STREAM_FILTERS`, the filters of the `earnings-recording` registration, names which stream records trigger recording. Both are the only code that knows #284's shapes. Discounts from #285 are already inside the order's discount and paid amounts, so coupons need no code here.

**Action**: before Phase 2 starts, re-read #284 and #285's merged specs and adjust these two files and the data-model assumption, noting any difference in the PR.

## R-10: Local development

**Decision**: Recording needs no local wiring of its own beyond its registration and an entry in `HANDLERS` (`packages/events/src/router/handlers.ts`): the event runner builds its router and one feature runner per `STREAM_FEATURES` entry, so the handler runs from its own ElasticMQ queue with the same batching, retries and failure queue as when deployed (`GET /router/queues`, `POST /router/redrive/earnings-recording` on port 2024). Its fee and hold settings are set in the runner's environment from `common-server-utils/local-dev`. The payout run runs on a timer in the event runner (and a `POST` on the runner's port for tests and e2e, like the transcoder's triggers). Stripe calls go through `common-server-utils/stripe-connect.ts`, which targets the local Stripe stand-in when `LOCAL_DEV=true`; if #284 has no stand-in, one small fake (accounts, account links, login links, transfers, with idempotency keys) is added to `common-scripts` beside the others.

**Only on a deployed stage**: hosted Stripe onboarding, real transfers and their failure reasons, the schedule's actual firing, and the Secrets Manager grant. Those are `(human)` tasks.

## R-11: Report periods

**Decision**: The report takes `from` and `to` as UTC dates (inclusive), at most 366 days; the portal's month picker sends a month's first and last day. The query is one range over `earningDay` by day, so periods are exact days, not timestamps.

**Alternatives**: arbitrary timestamps (needs the ledger, not summaries, and no one needs sub-day reports).
