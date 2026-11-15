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

**Decision**: A new table-stream consumer, `events-earnings-recording`, reacts to paid `order` and new `refund` records (via `EARNINGS_STREAM_FILTERS`, the same pattern as `PROGRESS_STREAM_FILTERS`) and calls `recordSale` / `recordRefund`.

**Rationale**: checkout stays free of payout logic, and a failure retries like any failed stream batch. The helpers are idempotent by key, so redelivery and concurrency converge, which is the property the spec's SC-002 asks for. Retry exhaustion lands on the existing failure queue.

**Alternatives**: recording inside #284's webhook handler (couples the two features and a payout bug could fail a payment confirmation); a transaction with the order write (the order writer would need to know instructors and fee).

## R-3: Entry and summary written together

**Decision**: `recordSale` and `recordRefund` use one DynamoDB transaction: Put the `earningEntry` with a condition that its key does not exist, and Update (ADD) the matching `earningDay` row. If the condition fails, the transaction cancels and the helper returns the existing entry.

**Rationale**: the report reads summaries while the drill-down reads entries, so they must never disagree, and they cannot if one atomic write does both. An invariant (`earning-day-matches-entries`) backs it up.

**Alternatives**: computing the report from entries per request (cost grows with orders, breaking SC-004); summaries updated by a second stream consumer (eventually consistent, a second feedback path to guard, and the report would lag the ledger).

## R-4: Access patterns on the single GSI

**Decision**: See [data-model.md](./data-model.md). Primary keys carry every pattern except two, which use `gsi1pk-gsi1sk-index`: the daily run lists active payout accounts (`gsi1pk` = account status, `gsi1sk` = instructor ID), and the run reads an instructor's open entries (`gsi1pk` = `open` plus instructor ID, `gsi1sk` = release time plus entry ID, present only while the entry is unpaid). Key prefixes ElectroDB adds keep entities apart, and a test using `.params()` proves it.

**Rationale**: constitution V: no scans and no new index without a named pattern; these two are the only patterns the primary key cannot serve. The run is a scheduled job, not a user request, but a keyed query is cheaper and safer than a scan anyway.

**Fallback**: if ElectroDB cannot remove an index key when an entry is settled (risk R2), keep a `payoutBalance` record per instructor and currency, updated in the same transaction as each entry and each payout, and drop the open-entries index.

## R-5: Rounding, split and refund shares

**Decision**: Amounts are integers in minor units. Fee = round-half-up of paid x basis points / 10000; instructor amount = paid - fee. Equal split among N instructors, sorted by instructor ID, with the remainder minor units given to the first ones one each (applied separately to gross, discount and fee, so each instructor's net is derived and the identity holds per entry). Refund entries use cumulative shares: for an order's refunds sorted by (created time, refund ID), the share for refund k is share(cumulative after k) minus share(cumulative before k), where share applies the same fee and split rules to the cumulative refunded amount. The refunded total is capped at the amount paid.

**Rationale**: cumulative shares make the whole sequence exact (a full refund in any number of pieces returns precisely the whole fee and every instructor's whole amount), independent of the order events are processed in, and idempotent per refund because the cumulative reads refund records, not previous entries.

**Alternatives**: proportional rounding per refund (accumulates cent errors, and a full refund in thirds would not net to zero); floating point (forbidden by FR-020).

## R-6: Account status: pull, not webhook

**Decision**: `payout.account` retrieves the connected account from Stripe and updates the stored status when the instructor opens the Earnings page and after returning from onboarding; the payout run retrieves it again before it sends. Mapping: no `details_submitted` = in progress; `payouts_enabled` and `charges`/requirements clear = active; otherwise restricted.

**Rationale**: a Connect webhook adds a public route, a second signing secret and a verification path to build, secure and run locally; the information is only needed when an instructor looks or before money moves, and both can fetch it live. Stripe also refuses a transfer to a restricted account, which shows as Failed and retries.

**Alternatives**: a signed Connect webhook (better freshness; a follow-up if instructors need to be notified of a restriction, which would fit the notifications spec #331).

## R-7: Hold, minimum, failures and refunds after sending

**Decision**: An entry is *released* once `releaseAt` (sale time + `holdDays`) has passed; refund entries release at once. The daily run, for each active account and currency, sums its open released entries, and sends one transfer only if the sum is at least `minimumPayoutMinor`. A sum at or below zero stays open (a refund after sending nets against future sales). A rejected transfer marks the payout Failed with Stripe's reason and returns its entries to open. The transfer is created with the payout's ID as Stripe's idempotency key, and the payout record exists (pending) before the call, so a crash between the call and the record is repaired by the next run reading the pending payout and repeating the same keyed call.

**Rationale**: it keeps the run simple, retry-safe and free of Stripe-side clawbacks. Reversing transfers needs the connected account to hold the funds and adds failure paths we would test only on a deployed stage.

**Alternatives**: reversing transfers on refund (spec's original FR-014 "when possible": amended in this PR to deduction only; a follow-up can add reversals); instructor-requested payouts (out of scope).

## R-8: Stage settings

**Decision**: `payouts: { platformFeeBasisPoints, holdDays, minimumPayoutMinor }` in the stage types, with defaults documented in `stages.config.ts` comments (2000 bp = 20%, 14 days, 1000 minor units) and a unit test rejecting a fee outside 0 to 10000 and negative or non-integer days and minimums. Values reach the two Lambdas as environment variables set by the construct from construct props. Fee in basis points avoids decimal percentages.

**Alternatives**: per-course or per-instructor fees (rejected in Clarifications); an AppConfig value (the stage config is the established place for deploy-time choices, and a fee should change by deploy, not by a console click).

## R-9: Seams to #284 and #285

**Decision**: Assume an `order` record (order ID, buyer, course, currency, gross, discount, amount paid, status, paid time) and a `refund` record (refund ID, order ID, amount, created time, reason `refund` or `dispute`), queryable by order. `earnings-from-order.ts` maps them into `revenue.ts` input, and `EARNINGS_STREAM_FILTERS` names which stream records trigger recording. Both are the only code that knows #284's shapes. Discounts from #285 are already inside the order's discount and paid amounts, so coupons need no code here.

**Action**: before Phase 2 starts, re-read #284 and #285's merged specs and adjust these two files and the data-model assumption, noting any difference in the PR.

## R-10: Local development

**Decision**: Recording runs as a stream consumer in the local event runner next to progress recalculation. The payout run runs on a timer in the event runner (and a `POST` on the runner's port for tests and e2e, like the transcoder's triggers). Stripe calls go through `common-server-utils/stripe-connect.ts`, which targets the local Stripe stand-in when `LOCAL_DEV=true`; if #284 has no stand-in, one small fake (accounts, account links, login links, transfers, with idempotency keys) is added to `common-scripts` beside the others.

**Only on a deployed stage**: hosted Stripe onboarding, real transfers and their failure reasons, the schedule's actual firing, and the Secrets Manager grant. Those are `(human)` tasks.

## R-11: Report periods

**Decision**: The report takes `from` and `to` as UTC dates (inclusive), at most 366 days; the portal's month picker sends a month's first and last day. The query is one range over `earningDay` by day, so periods are exact days, not timestamps.

**Alternatives**: arbitrary timestamps (needs the ledger, not summaries, and no one needs sub-day reports).
