# Research: Instructor Revenue Reporting and Payouts

## R-1: Payout mechanism

**Decision**: Stripe Connect Express accounts. The platform charges the student on its own Stripe account (as #284 does), records instructor earnings in its own ledger, and, after a hold period, sends each instructor's released balance to their connected account as a Stripe transfer. Stripe pays the instructor's bank on its own schedule. Discava shows its own transfer status and links to the Express dashboard for the rest.

**Rationale**:

- The issue names Stripe Connect onboarding, and Express keeps identity, bank details and tax forms in Stripe's hosted flow, so Discava stores none of it (FR-010).
- Separate charges and transfers fit a course taught by several instructors (equal split, FR split rule): one charge, several transfers. Destination charges pay one connected account per charge.
- Holding the money on the platform until the hold period ends makes refunds cheap: most refunds arrive before anything was sent, so nothing needs reversing.
- A ledger of our own is what makes "totals reconcile with orders and refunds" provable by invariants, independent of Stripe's reports.
- It runs on Lambda, DynamoDB and an EventBridge schedule, so it respects the serverless, AWS-only stance. Stripe is a service call, not a pluggable backend.

**Alternatives**:

- *Reporting-only first slice (manual payouts by the operator)*: simplest and avoids Connect, but the issue asks for onboarding and payout status, and manual bank transfers do not scale or reconcile. The ledger built here is the same thing a manual process would need, so reporting is Phase 3 and the money-moving phases (4 and 5) can be dropped or deferred by the maintainer without wasting the rest.
- *Destination charges with `application_fee_amount`*: Stripe splits at charge time, so there is no hold or ledger to run. Rejected: one destination per charge breaks multi-instructor courses, refunds must reverse transfers on Stripe's side, and the platform would depend on Stripe's reports for reconciliation.
- *Standard or Custom accounts*: Standard sends instructors through full Stripe accounts and hands the platform less control; Custom makes Discava responsible for onboarding UI and compliance. Rejected as worse fits for an opinionated, small platform.

## R-2: Where earnings are recorded

**Decision**: Earnings recording is a feature of the core table's stream router. It adds an `earnings-recording` entry to `STREAM_FEATURES` (core-table `helpers/stream-features.ts`): filters `EARNINGS_STREAM_FILTERS` (an inserted or modified `order`), handler `events-earnings-recording`, batch 100 records / 5 s, `maxReceiveCount` 5, `maxConcurrency` 2. The table's stream keeps its one reader, the `StreamRouter`; the construct builds the feature's queue, failure queue, alarm and mapping from the entry, and the local event runner builds the same from it over ElasticMQ. The handler calls `recordSale` / `recordRefund`.

**Rationale**: checkout stays free of payout logic. Constitution v1.2.1 (principle V) and CLAUDE.md require a feature to register in `STREAM_FEATURES` and not attach its own stream source, so the stream stays at one reader. The router delivers at least once and in no guaranteed order, and the design tolerates both without relying on redelivery: every image of a sale order carries its amounts, `paidAt` and refunded total, so any one image is enough to record the sale and bring the refunded total up to date (R-5). `recordSale` is idempotent by key, and `recordRefund` is a no-op for a total the ledger has already reached, which is the property the spec's SC-002 asks for. A batch that fails is redelivered by the queue after its visibility timeout; after 5 receives the message goes to the feature's own failure queue, whose alarm fires, and a redrive replays it once the cause is fixed (`POST /router/redrive/earnings-recording` locally, the SQS redrive when deployed). The concurrency cap of 2 is for the `earningDay` row that sales of one course share (plan risk R6).

**Alternatives**: a table-stream event source mapping of its own (the first draft of this spec; main's stream router exists to prevent a further stream reader, and the registration gets retries, a failure queue and an alarm without building them); recording inside #284's webhook handler (couples the two features and a payout bug could fail a payment confirmation); a transaction with the order write (the order writer would need to know instructors and fee).

## R-3: Entry and summary written together

**Decision**: `recordSale` and `recordRefund` use one DynamoDB transaction: Put the `earningEntry` with a condition that its key does not exist, and Update (ADD) the matching `earningDay` row. If the condition fails, the transaction cancels and the helper returns the existing entry. Refunds are also serialised per order: a per-order record, `earningOrder`, holds the refunded total already in the ledger, and a refund's transaction raises it with the condition that it still holds the value the refund's shares were computed from (R-5). A sale's transaction holds two items per instructor plus the `earningOrder`, far below DynamoDB's 100-item limit for any real course.

**Rationale**: the report reads summaries while the drill-down reads entries, so they must never disagree, and they cannot if one atomic write does both. An invariant (`earning-day-matches-entries`) backs it up.

**Alternatives**: computing the report from entries per request (cost grows with orders, breaking SC-004); summaries updated by a second stream feature (eventually consistent, a second feedback path to guard, and the report would lag the ledger).

## R-4: Access patterns on the single GSI

**Decision**: See [data-model.md](./data-model.md). Primary keys carry every pattern except four, which use `gsi1pk-gsi1sk-index`: the daily run lists the current payment account's active payout accounts (`payoutAccount.byStatus`); the run and the overview read an instructor's open entries and a payout's entries (`earningEntry.bySettlement`: `gsi1pk` is `open#<instructorId>` while the entry has no payout and `payout#<payoutId>` once it has); recovery lists unsettled payouts (`payout.payoutsByStatus`). Key prefixes ElectroDB adds keep entities apart, and a test using `.params()` proves it.

**Rationale**: constitution V: no scans and no new index without a named pattern; these are the only patterns the primary key cannot serve. The run is a scheduled job, not a user request, but a keyed query is cheaper and safer than a scan anyway. `bySettlement` replaces an earlier sparse "open entries" index plus a list of entry keys on the payout: the sparse index depended on ElectroDB removing an index key when an entry was settled, and the key list was bounded by DynamoDB's item size. One key that changes value has neither problem.

## R-5: Rounding, split and refund shares

**Decision**: Amounts are integers in minor units.

- **Fee**: fee(x) = round-half-up of x times basis points / 10000, in integer arithmetic. The sale's fee is fee(paid); the instructor amount is paid minus fee.
- **Split**: split(x) shares x equally among the N instructors sorted by instructor ID, giving the remainder minor units one each to the first ones. A sale applies it to the gross, to the amount paid and to the fee. Each instructor's discount is their gross share minus their paid share, and their net is their paid share minus their fee share.
- **Refund**: with R0 the refunded total `earningOrder` already holds and T the order's refunded total (capped at the amount paid), a refund's entries are share(T) minus share(R0), where share(x) is, per instructor, split(x) of the refund and split(fee(x)) of the fee returned.
- **Serialising**: the read of R0 and the write are serialised per order by a condition on `earningOrder.refundedMinor = R0` inside the R-3 transaction; if it fails because another refund was recorded first, the helper re-reads and recomputes (up to 5 attempts, then throws so the queue redelivers), and a total at or below the new R0 is a no-op.

**Rationale**: the shares telescope in the order refunds are *recorded*, and at T = paid they equal the sale exactly, because the sale's own shares are split(paid) and split(fee(paid)). So once the recorded total equals the amount paid, the refund entries return exactly the whole fee and every instructor's whole amount, however many pieces and whatever order records arrive in.

The split must be applied to the amount paid, not to the discount. Splitting gross and discount separately and deriving the paid share breaks the full-refund identity: gross 100, discount 1, two instructors gives gross 50/50 and discount 1/0, so paid shares 49/50, while a full refund of 99 splits 50/49. Each instructor would end one minor unit out. With the rule above the paid shares are 50/49 in both places, and the discount shares (0/1) are derived.

Working from the order's cumulative total rather than from individual refunds is forced by #284: it stores no refund record and no refund ID, only `refundedAmount`, which only grows. It also makes ordering harmless: paid 2, fee 5000 bp so the sale fee is 1, refunded in two steps of 1. Seen in order, the first entry returns fee(1) = 1 of the fee and the second fee(2) - fee(1) = 0. Seen in reverse, the image with total 2 records one entry returning 1, and the image with total 1 is a no-op. Either way 1 is returned in total, never 2.

Two rounding edges are accepted and tested: an instructor's share of one refund can be zero in every figure (no entry is written for them), and it can be a returned fee of one minor unit with no refunded amount (a refund entry with a net of +1). Both vanish in the totals.

**Alternatives**: proportional rounding per refund (accumulates cent errors, and a full refund in thirds would not net to zero); floating point (forbidden by FR-020).

## R-6: Account status: pull, not webhook

**Decision**: `payout.account` retrieves the connected account from Stripe and updates the stored status when the instructor opens the Earnings page and after returning from onboarding; the payout run retrieves it again before it sends. The Express account is created requesting the `transfers` capability only (the platform, not the instructor, takes card payments). Mapping: no `details_submitted` = in progress; the `transfers` capability `active` and `payouts_enabled` = active; otherwise restricted. T017 confirms these fields against the types of the Stripe API version `common-server-utils/stripe/client.ts` pins.

**Rationale**: a Connect webhook adds a public route, a second signing secret and a verification path to build, secure and run locally; the information is only needed when an instructor looks or before money moves, and both can fetch it live. Stripe also refuses a transfer to a restricted account, which shows as Failed and retries.

**Alternatives**: a signed Connect webhook (better freshness; a follow-up if instructors need to be notified of a restriction, which would fit the notifications spec #331).

## R-7: Hold, minimum, failures and refunds after sending

**Decision**: An entry is *released* once `releaseAt` (sale time + `holdDays`) has passed; refund entries release at once. The daily run, for each active account and currency of the current payment account, sums its open released entries, and sends one transfer only if the sum is at least `minimumPayoutMinor`. A sum at or below zero stays open (a refund after sending nets against future sales).

*Creating the payout.* DynamoDB transactions hold at most 100 items, and a course that sells well gives its instructor more released entries than that in one hold window, so "the payout and all its entries in one transaction" would fail for exactly the instructors with most to be paid, on every run. Capping a payout at 99 entries does not work either: after a mass refund the oldest 99 open entries can sum below zero for good. So the payout collects its entries in batches while `collecting`, each batch one transaction that marks up to 99 entries and adds their sum to the payout, and is then sealed `pending`. A transfer is only ever created for a `pending` payout, for the amount its entries sum to. A payout that will not be paid (a batch lost an entry to another run, the run died while collecting, or Stripe rejected the transfer) goes through `releasing`, where its entries are cleared in batches, and ends `failed` (rejected) or deleted (never sent). The lifecycle is in data-model.md.

*Sending.* Every transfer is created with `transfer_group` and metadata set to the payout ID, plus the payout ID as Stripe's idempotency key. Stripe may forget an idempotency key after about 24 hours, so the key alone is not enough to make a late retry safe. Recovery therefore works from the transfer itself: the daily run first looks at every unsettled payout of the current payment account (found by `payoutsByStatus`, whatever the instructor's account state) whose last attempt is older than a 15-minute grace period, and claims it with a conditional update of `attemptedAt` (so two overlapping runs cannot both act on it). For a `pending` one it lists transfers by `transfer_group` = payout ID. If one exists, it marks the payout sent with that transfer; only if none exists does it create one (same key and group). The outcome of a create is classified: success marks sent; a *definite rejection* from Stripe (an invalid-request or permission error: an account that cannot receive transfers, a platform balance that is too low) marks the payout failed and reopens its entries; anything *uncertain* (an idempotency conflict because another request with the same key is still in flight, a timeout or connection error, a 5xx, a rate limit, an authentication error) leaves the payout pending for the next run's recovery. A payout is never marked failed unless Stripe definitely refused it, because a transfer that went through must never have its entries reopened (SC-006).

**Rationale**: it keeps the run retry-safe at any size and free of Stripe-side clawbacks. Reversing transfers needs the connected account to hold the funds and adds failure paths we would test only on a deployed stage.

**Alternatives**: reversing transfers on refund (spec's original FR-014 "when possible": amended in this PR to deduction only; a follow-up can add reversals); instructor-requested payouts (out of scope); a running balance record per instructor instead of marking entries (release is by time, so the balance cannot be kept by writes alone, and "which entries did this payout pay" would be lost).

## R-8: Stage settings

**Decision**: `payouts: { platformFeeBasisPoints, holdDays, minimumPayoutMinor }` in the stage types, with defaults documented in `stages.config.ts` comments (2000 bp = 20%, 14 days, 1000 minor units) and a unit test rejecting a fee outside 0 to 10000 and negative or non-integer days and minimums. Values reach the two Lambdas as environment variables set by the stacks that build them (the router's stack for recording, the Payouts stack for the run), from stack props. Fee in basis points avoids decimal percentages.

**Alternatives**: per-course or per-instructor fees (rejected in Clarifications); an AppConfig value (the stage config is the established place for deploy-time choices, and a fee should change by deploy, not by a console click). The Stripe key is the opposite case: #284 made it a run-time setting an administrator saves, and this feature reads it from there (R-12), not from stage config.

## R-9: Seams to #284 and #285

**Decision**: #284's spec and its core-table code (`entities/order.ts`, `helpers/order.ts`, `helpers/payment-connection.ts`, `common-server-utils/stripe/`) are on `main`, and this design is written against them: data-model.md "Inputs" lists the order fields read and the rule for which orders are sales. Two files are the only code that knows the order's shape: `EARNINGS_STREAM_FILTERS` (which stream records trigger recording) and `earnings-from-order.ts` (order image to `revenue.ts` input). #285 (coupons) is specified but not built; its contract names the charged amount `totalAmount` where #284's entity has `amount`. The seam reads `listAmount` and `amount` and derives the discount, so it needs none of #285's new fields.

What #284 changed from this spec's first assumptions, and what followed:

- No refund record or refund ID, only the order's cumulative `refundedAmount`: refunds are recorded up to a total (R-5), triggered by order MODIFY images.
- `paidAt` is also set on orders refunded automatically as undeliverable: a sale is defined by `status` and `refundReason`, not by `paidAt`.
- The Stripe key is saved at run time by an administrator and the account can be switched: R-12.
- Disputes are handled by hand: R-13.

**Action**: T010 re-reads both when Phase 2 starts, in case #285's code or the rest of #284 has landed with a difference.

## R-10: Local development

**Decision**: Recording needs no local wiring of its own beyond its registration and an entry in `HANDLERS` (`packages/events/src/router/handlers.ts`): the event runner builds its router and one feature runner per `STREAM_FEATURES` entry, so the handler runs from its own ElasticMQ queue with the same batching, retries and failure queue as when deployed (`GET /router/queues`, `POST /router/redrive/earnings-recording` on port 2024). Its fee and hold settings are set in the runner's environment from `common-server-utils/local-dev`. The payout run runs on a timer in the event runner (and a `POST` on the runner's port for tests and e2e, like the transcoder's triggers).

Stripe calls go through `common-server-utils/stripe/client.ts`, which already points the SDK at the local stand-in (`packages/events/src/local/stripe-stand-in.ts`) when `LOCAL_DEV=true` and reads the key from the local secrets store. The stand-in is extended with the Connect slice this feature uses: Express accounts, account links (a local onboarding page), login links, transfers (idempotent by key, kept with their `transfer_group`, listable by group) and test controls. Connected accounts and transfers are kept per platform account, as Stripe keeps them, and saved to a file under the git-ignored `tmp/local-dev/`, so restarting `pnpm dev` does not strand the `payoutAccount` records that point at them.

**Only on a deployed stage**: hosted Stripe onboarding, real transfers and their failure reasons, the schedule's actual firing, the Stripe key grant, and whether the administrator's key may use Connect. Those are `(human)` tasks.

## R-11: Report periods

**Decision**: The report takes `from` and `to` as UTC dates (inclusive), at most 366 days; the portal's month picker sends a month's first and last day. The query is one range over `earningDay` by day, so periods are exact days, not timestamps.

**Alternatives**: arbitrary timestamps (needs the ledger, not summaries, and no one needs sub-day reports).

## R-12: The Stripe key and the payment account

**Decision**: This feature has no Stripe secret of its own. instructor-api's `payout` procedures and the payout run read the key an administrator saved (#284's `paymentConnection` record and the two secrets), with a read grant on the key only. Every earning, payout account and payout records the *payment account* of its order: the order's `accountId` plus `mode` (`order.mode` is added by this feature). Money only moves inside one payment account:

- The run reads the connection first. Unless it is `active` it sends nothing. It then pays only entries of that payment account, to payout accounts created under it, and recovers only that payment account's payouts.
- Before any other Stripe call, the caller checks the key in hand belongs to the connection's account and mode (the saved key is cached for five minutes, so a process can hold the old key just after a switch). The run pins one client for its whole duration.
- After a switch to another account or mode, an instructor's payout account for the new one does not exist: the page shows Not set up and they onboard again. Open earnings from the old payment account stay recorded and are shown as Held. They are never paid from the new one. If the administrator switches back, they are paid as normal. Otherwise the operator settles them outside Discava.
- Refunds for the old payment account's orders stop arriving after a switch (#284 rejects events signed for the old registration), so held balances no longer change.

**Rationale**: Express accounts and the balance transfers draw on belong to one Stripe platform account in one mode. A connected account ID from another platform account is rejected by Stripe; a transfer listing with another account's key finds nothing, which recovery would misread as "not sent yet". Mode matters as much as account: a test key and a live key of one Stripe account share an `accountId`, and without `mode` a stage that went from test to live would pay test-mode sales with real money.

**Alternatives**: refusing an account switch while unpaid earnings exist (it would block every switch for at least the hold period, needs a table-wide "any open entry" pattern, and changes #284's lease, which is built); deriving the mode when the sale is recorded (wrong for an order processed after a switch, for example from a redrive); a per-stage Stripe secret in stage config (the first draft; #284 replaced it).

**Limit**: #284's connection check does not test that the key may use Connect. If the platform has not enabled Connect, or a restricted key lacks the permission, onboarding answers with a clear message (contract) and the docs say what the key needs; a `(human)` task confirms the permissions on a deployed stage.

## R-13: Disputes

**Decision**: Out of scope. #284 has no dispute event: an operator handles a dispute in Stripe's dashboard. A lost dispute is not a refund (`charge.refunded` is not sent for it), so the order's `refundedAmount` does not move and no adjustment is recorded: the instructor keeps the earning and the platform bears the loss and Stripe's dispute fee. When the operator settles a dispute by refunding the payment, the refund is recorded like any other.

**Rationale**: this spec's first draft reversed the instructor amount on a lost dispute, assuming #284 would deliver one "like a full refund". It does not, and adding dispute webhooks belongs to checkout. The maintainer may prefer the instructor to bear a lost dispute; that needs a dispute event from #284 first, and is listed as an open question on the PR.
