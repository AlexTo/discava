# Implementation Plan: Stripe Checkout for Paid Courses

**Branch**: `20261116-013315-stripe-checkout` | **Date**: 2026-11-16 (amended 2026-11-18: admin-configured Stripe; 2026-11-19: learner refunds and leaving a course) | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261116-013315-stripe-checkout/spec.md`

## Summary

A course gains a required price (amount in minor units plus currency; zero is free). core-api's `course.enrol` refuses a priced course, and a new `payment.checkout` procedure records a pending `order` and returns a Stripe-hosted Checkout URL. A new webhook Lambda, behind its own API Gateway, verifies Stripe's signature and, on `checkout.session.completed`, runs one `core-table` helper that marks the order paid and creates (or restores) the enrolment in one transaction. `checkout.session.expired` closes the order; `charge.refunded` records the refund and, for a full refund, ends the enrolment with the existing `dropped` status. Undeliverable payments (already enrolled, course no longer published, a paid session that does not match its order) are refunded automatically. A refunded student gets back into a course that is later set to free through `course.enrol`, which restores the same enrolment. Stripe credentials are not deployment settings: an administrator pastes the Stripe secret key on a Payments page in the admin portal, and a dedicated admin-api function verifies it, registers the platform's own webhook endpoint with Stripe, and writes the key and the returned signing secret into two Secrets Manager secrets; a singleton `paymentConnection` record holds the non-secret facts and a running "latest checkout expiry" that gates switching accounts. Until it is connected, checkout and pricing are refused. Locally, a Stripe stand-in in the event runner (hosted pay page, the slice of Stripe's API used, correctly signed webhooks, test controls for duplicates and refunds) takes the place of Stripe, selected by `LOCAL_DEV=true` like S3Mock and the local OIDC server.

**Amendment 2026-11-19 (learner refunds and leaving a course).** Two procedures let a student end a paid enrolment with their money back, and one lets them leave an unpaid one. `payment.requestRefund` checks the terms (14 days from `paidAt`, enrolment not completed), asks Stripe to refund what is left, and records `refundRequestedAt`; the order and the enrolment still change only in the `charge.refunded` handler, which now also publishes one `order.refunded` notification. `payment.myOrder` gives the course page the state of the student's own purchase. `course.unenrol` moves an enrolment with no order to `dropped`, and the existing free restore in `course.enrol` brings it back. No new entity, index, function, stack or secret; one new order attribute, one widened invariant, one notification type (research R-20 to R-23).

What the code showed that the spec could not:

1. **Enrolment is one transaction in `course.enrol`** (`packages/apis/core-api/src/procedures/enrolment.ts`): a `check` that the course is `published` plus an `enrolment.create`. The paid rule belongs in that same transaction (`priceAmount = 0` joins the check), so a price set at the same moment cannot be raced, and the failure reasons already distinguish "course not available" from "already enrolled".
2. **`dropped` has no writer today**, but every reader already treats it as not enrolled: `requireEnrolment`, `my-enrolments`, the progress recalculation, `studentActivityWrites`' `lastActivityAt` write, and the portal's enrolment actions. Ending an enrolment with it needs no new access check anywhere. The two places that tie `completedAt` to `completed` (the `completed-at-iff-completed` and `certificate-has-completed-enrolment` invariants) do need widening, because a refunded, completed student keeps `completedAt`.
3. **The webhook cannot be a tRPC procedure.** Stripe signs the raw body and sends no Cognito token. `PUBLIC_OPERATIONS` skips the authorizer for tRPC operations but still parses JSON bodies through the router. The webhook is its own Lambda behind its own API Gateway method, and shares no function with signed-in code (FR-021).
4. **Local dev has one event runner on port 2024** that already stands in for MediaConvert, Scheduler, the table stream and Cognito's trigger. The Stripe stand-in lives there too and mounts the same handler function the deployed Lambda wraps, so local runs exercise the real verification and fulfilment code.
5. **The admin portal has no backend.** `packages/websites/admin-portal` is a stub (a welcome route, only the core-api client). The catalogue categories (#283) and course reviews (#279) specs both plan one shared `admin-api`, generated with `ts#trpc-api`, requiring the `admin` group; this feature uses it too (research R-19), with its credential-writing function kept apart from the shared router.
6. **The course search document** (`packages/events/src/search/course-document.ts`) lists course fields by name, so the price must be added there for catalogue cards to show it. The catalogue-categories spec (#283) adds fields to the same document; the two touch different lines and neither blocks the other.

## Technical Context

**Language/Version**: TypeScript (Node 24 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC + zod, ElectroDB (`@discava/core-table`), the official `stripe` Node SDK (new, pinned, in core-api, events and `common-server-utils/stripe`), AWS SDK Secrets Manager client (`@aws-sdk/client-secrets-manager`, read and, in the admin function only, write), the shared `admin-api` (generated by #283 or here), TanStack Router/Query, shadcn (`@discava/common-shadcn`), `@discava/common-web-utils` (new `price` module)

**Storage**: the one core table; new `order`, `paymentConnection` (singleton) and `paymentChange` entities; `course` gains `priceAmount`, `priceCurrency`, `pricedAt`; `enrolment` gains `orderId`; `order` carries `accountId`. Two Secrets Manager secrets, created by the deployment and filled at run time by an administrator

**Testing**: vitest per project (with the `@discava/core-table` alias), core-table `helpers/invariants.ts`, instructor and student portal component tests, Playwright e2e in `packages/e2e` including `src/concurrency/`, CDK synth/assertion tests in `packages/infra` and constructs

**Target Platform**: AWS Lambda + API Gateway + CloudFront + Secrets Manager; `pnpm dev` with Docker locally

**Project Type**: web application: serverless backend + React portals

**Performance Goals**: enrolled within 30 s of payment (Stripe delivers within seconds; the Lambda does a handful of keyed reads and one transaction); checkout creation under 2 s (one Stripe API call)

**Constraints**: no second table; no scans in user requests; no secret outside Secrets Manager and none in stage config, code or a browser; credentials written only by one admin-only function; the webhook shares no function with signed-in APIs; stacks under 500 resources; no compatibility code for old data (price attributes required, backfilled by hand)

**Scale/Scope**: one order per checkout attempt; a handful of writes per purchase

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | Lambda, API Gateway, DynamoDB, Secrets Manager. Stripe is an external SaaS the issue names; it is called over HTTPS and adds no pluggable backend: there is no payment-provider abstraction, the code speaks Stripe |
| II. Generators first | Pass, with two hand-written pieces | The `admin-api` is generated with `ts#trpc-api` and connected with `connection` (by #283, or by this feature's admin phase if it comes first; the task consults `generator-guide` and records the output). A dedicated-function mechanism for `PaymentsConnect` mirrors core-api's `CORE_API_DEDICATED_FUNCTIONS` and is added by hand if the generated admin-api lacks it. The webhook Lambda wrapper is generated with the `ts#lambda-function` generator into `packages/events` like the other handlers (T036 confirms the generator command with `generator-guide`). The checkout procedure extends core-api by hand-adding a procedure, as every procedure is. No generator fits "API Gateway method with a raw-body Lambda and no authorizer": `ts#trpc-api` generates tRPC APIs, so the `StripeWebhookApi` construct is hand-written, small, and the plan says so here. The secrets are plain CDK `Secret`s |
| III. Everything runs locally | Pass | The Stripe stand-in in the event runner replaces Stripe and its webhook delivery; secrets come from a git-ignored local store, `tmp/local-dev/secrets/`, written by the same admin flow (nothing pre-connected; R-18), not Secrets Manager. Documented exception: Stripe's own hosted page, 3-D Secure and real card behaviour run only against Stripe's test mode on a deployed stage (a `(human)` task) |
| IV. Layered tests | Pass, planned | Unit tests for every helper, procedure, the webhook handler and the stand-in; invariants with breaking tests (below); an e2e scenario; a concurrency test. Impact check below |
| V. Single-table via ElectroDB | Pass | One entity (`order`); access patterns in [data-model.md](./data-model.md), all keyed, no scan in a user request (the only scan is `loadTableSnapshot` in the invariant tooling, T009), no new index: the existing `gsi1pk-gsi1sk-index` serves "a student's orders for a course". Stream consumers considered below |
| VI. Secure by default | Pass | Webhook verifies signatures, sits behind WAF and throttling that default to on, and its function has only the table and read on the two secrets; the checkout function reads only the API key; only the admin-only `PaymentsConnect` function can write them (a CDK test asserts no other role has `PutSecretValue`); `payment.status` never returns a secret and a test searches every response, error and log for the key; secrets are KMS-encrypted per stage config. Only `discava-development` relaxes WAF and KMS in `stages.config.ts` |
| VII. Change freely before launch | Pass | `priceAmount` and `priceCurrency` are required attributes backfilled by hand, with no fallback for a missing value; no redirects or aliases |
| VIII. Repo conventions | Pass | `core-table/src/helpers/order.ts`; price rules in `common-web-utils/price`; Stripe modules in `common-server-utils/src/stripe/` named for what they cover; text-only buttons, docs in English with translation noted |

No violations, so Complexity Tracking is empty.

**Impact check (constitution IV).** Shared records the feature writes or reads in a new way:

| Record | Use | Existing invariants and tests that already cover it | What changes |
|--------|-----|------------------------------------------------------|--------------|
| `enrolment` | Written by three new paths: the webhook's `settleOrderPaid` (create, or restore a `dropped` one), the refund path (`endEnrolmentForRefund`: status to `dropped`) and `course.enrol`'s `restoreFreeEnrolment` (a `dropped` one back to `active` or `completed` in a course that is now free, `orderId` removed). `course.enrol` still writes free enrolments. Gains `orderId` | `enrolment-in-published-course`, `completed-at-iff-completed`, `progress-matches-completions`, `student-records-enrolled`, `last-activity-at-current`, `certificate-has-completed-enrolment` | `completed-at-iff-completed` is **widened**: for an enrolment, `completedAt` set means `completed` or `dropped`, and `completed` still needs `completedAt` (its breaking tests are kept and extended with the new accepted case and the new refused case: `active` with `completedAt`). `certificate-has-completed-enrolment` is **widened**: a certificate's enrolment may be `dropped` with the same `completedAt`. `enrolment-in-published-course` already skips `dropped`. `last-activity-at-current` and `progress-matches-completions` do not look at status beyond `dropped`. Restoring writes the status the record already had (`completed` when `completedAt` is set, else `active`), so no check sees a new state |
| `course` | Read: `priceAmount`, `priceCurrency`, `status` (checkout, enrol, fulfilment). Written: price fields, only by instructor-api's `course.setPrice` | `course-has-instructor`, `instructor-course-updated-at`, `published-at-set` | `instructor-course-updated-at` stays satisfied: `setPrice` moves `updatedAt` and each instructor's `courseUpdatedAt` like other edits (its breaking test is extended). New `price-shape` check |
| `certificate` | Not written. A refund leaves it | `certificate-shape`, `certificate-has-completed-enrolment` | The widened check above |
| `order` (new) | Written by core-api (create pending with the connection's `accountId`, attach session) and the webhook (paid, expired, refunded) | none yet | New checks: `order-shape`, `paid-order-has-enrolment`, `enrolment-order-matches`, `paid-course-enrolment-paid`. `student-records-*`, `activity-count-matches-students` do not apply: an order is not student activity on an item and does not count towards `studentActivityCount` (a test pins it) |
| `paymentConnection` (new), `paymentChange` (new) | Written only by `helpers/payment-connection.ts` (called by the admin function); read by `startOrder` (inside its transaction), by `payment.available` and by instructor-api's `setPrice` | none yet | New checks `payment-connection-shape`, `checkout-window-covers-orders`, `order-account-known`, `payment-change-shape` (data-model.md). Neither entity is student activity, so the `student-records-*` and `activity-count-matches-students` checks do not apply (a test pins it). Neither entity's writes may match a stream filter: a test asserts a `paymentConnection` MODIFY (written on every checkout) matches neither `PROGRESS_STREAM_FILTERS` nor `SEARCH_STREAM_FILTERS` nor any `STREAM_FEATURES` registration |
| `itemCompletion`, `progress`, `quizAttempt`, assignment records | Untouched. A refunded student keeps them | `student-records-enrolled` already tolerates `dropped` enrolments ("enrolments are kept when a student drops out") | None |
| `user` | Not read. Orders are keyed by Cognito `sub` | `instructor-has-user` | None |
| Stream consumers | `order` inserts and modifies must match neither `PROGRESS_STREAM_FILTERS` nor `SEARCH_STREAM_FILTERS`. An enrolment MODIFY (restore, end) matches neither today. A `course` MODIFY of the price matches the search filter and re-indexes the same document with the price: wanted | `progress-stream.test.ts`, `search-stream.test.ts` | Add an assertion for each that an `order` write matches neither; add a search-stream case that a price-only course MODIFY is re-indexed. Restoring an enrolment does not trigger a progress recalculation (enrolment writes never do); progress is recomputed on the student's next activity or the next curriculum change, as for a new enrolment |

**Impact check for the 2026-11-19 amendment.**

| Record | Use | Existing invariants and tests that already cover it | What changes |
|--------|-----|------------------------------------------------------|--------------|
| `enrolment` | One more writer of `dropped`: `unenrolFromCourse`, for an enrolment with no `orderId` | `completed-at-iff-completed` and `certificate-has-completed-enrolment` (both already widened for `dropped`), `enrolment-order-matches`, `student-records-enrolled` | No rule changes. `enrolment-order-matches` is what forbids leaving a paid enrolment; a breaking test is added for a `dropped` enrolment whose order is still `paid` if none exists. `entity-writers` is regenerated |
| `order` | One more writer: core-api's `markRefundRequested` sets `refundRequestedAt` on a `paid` order. Read by `payment.myOrder` (the caller's own, through the existing student-and-course index) | `order-shape`, `paid-order-has-enrolment`, `order-account-known` | `order-shape` widened: `refundRequestedAt` needs `paidAt`, is not before it, and the order is `paid` or `refunded`. New breaking tests; the old ones stay |
| `paymentConnection` | Read by `refundEligibility` (is the order's account the active one) | `payment-connection-shape` | None. A refund does not open or extend the checkout window |
| `notification` and its preferences | One more producer, the `charge.refunded` handler, through core-table's notification helpers | the notification invariants in `helpers/invariants/notifications.ts` | A new type in `notification-types.ts` with its test; no rule changes |
| `certificate`, `itemCompletion`, `progress`, `quizAttempt`, assignment records | Untouched. A student who left keeps them, as a refunded student does | as in the table above | None |
| Stream consumers | An enrolment MODIFY to `dropped` by leaving is the same change a refund makes: it matches neither the progress nor the search filter, and the analytics update counts it as dropped | `progress-stream.test.ts`, `search-stream.test.ts`, the analytics update tests | A test case that leaving is counted once, as a refund-end is |

## Design Decisions (detail in [research.md](./research.md))

1. **State-based idempotence, no event log.** Every order move is conditioned on the status it comes from. A replayed, duplicated or concurrent confirmation finds the work done and does nothing; the handler still answers success (research R-1).
2. **Fulfilment is one transaction.** `settleOrderPaid` writes the order (`pending` to `paid`), the enrolment (create, or restore from `dropped`) and checks the course is `published`, together. A transaction cancelled by a failed condition is re-read and decided again, up to three times (R-2).
3. **Refund ends the enrolment with `dropped`**, keeps `completedAt`, progress and certificates; re-purchase restores it, and so does a free `enrol` once the course is free. `orderId` on the enrolment names the order that currently entitles it (R-3).
4. **Undeliverable payments are refunded by the handler**, with a Stripe idempotency key per order, then the order moves `pending` to `refunded` with a reason (R-4). A verified paid session whose student, course, amount or currency differ from the order's is one of them (`mismatch`): it is refunded, never logged and left.
5. **One webhook function, own API Gateway, own stack**, built from a hand-written `StripeWebhookApi` construct; two secrets for least privilege (R-5, R-6).
6. **An administrator connects Stripe at run time** (amendment 2026-11-18): one pasted key, verified, the platform registers its own webhook endpoint and keeps the returned signing secret; rotation touches one secret; a switch or disconnect needs no open checkout, decided by one conditional write on a connection record's running latest-checkout expiry (R-14 to R-17, R-19).
7. **Stripe stand-in in the event runner**, speaking the slice of Stripe's HTTP API the code uses, so the real `stripe` SDK runs unchanged against it via host/port settings (R-7).
8. **Price handling**: integers in minor units, one shared module `common-web-utils/price` (currencies, bounds, validation, formatting) used by instructor-api, core-api and the portals; orders carry `listAmount` and `amount` apart (R-8).
9. **Grandfathering by `pricedAt`**: the time the price last became non-zero is on the course; an unpaid enrolment is legitimate only if it is older than that (with a 10 s skew allowance) (R-9).
10. **Card-only, one-hour sessions, Adaptive Pricing off, polling return page**, per the Clarifications (R-10).

11. **A student's refund request asks Stripe and records a time; the confirmation makes the change** (amendment 2026-11-19). `requestRefund` calls `refunds.create` with idempotency key `refund-<orderId>`, then marks the order; it never moves the order or the enrolment. One path still ends a paid enrolment (R-20).
12. **Refund terms are one constant and one pure function**: `REFUND_WINDOW_DAYS = 14` and `refundEligibility`, used by the mutation to decide and by `payment.myOrder` to explain; a completed enrolment is not eligible (R-21).
13. **Leaving is `dropped` for an enrolment with no order**, written in `order.ts` beside the refund-end write and conditioned on the same `orderId` attribute, so the two cannot both win; the existing free restore is the way back. A paid enrolment cannot be left (R-22).
14. **One `order.refunded` notification per refunded order**, published by the webhook only when its conditional move succeeded (R-23).

## Project Structure

### Documentation (this feature)

```text
specs/20261116-013315-stripe-checkout/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── core-api-payment.md
│   ├── admin-api-payment.md
│   ├── admin-portal-ui.md
│   ├── instructor-api-course-price.md
│   ├── stripe-webhook.md
│   ├── stripe-stand-in.md
│   └── student-portal-ui.md
├── checklists/
│   ├── requirements.md
│   └── payments.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/
├── common/
│   ├── web-utils/src/price.ts                  # currencies, bounds, validatePrice, formatPrice (+ test); package exports map gains ./price
│   ├── server-utils/src/
│   │   ├── stripe/client.ts                    # stripeClient() (secret read + cache; stand-in host in local dev) (+ test)
│   │   ├── stripe/secrets.ts                   # getStripeApiKey(), getStripeWebhookSecret(), and admin-function-only writeStripeSecrets(); Secrets Manager deployed, tmp/local-dev/secrets/ locally (+ test)
│   │   ├── stripe/connect.ts                   # verifyKey, registerEndpoint, removeEndpoint over the stripe client (+ test)
│   │   └── local-dev.ts                        # LOCAL_STRIPE settings (stand-in host and port, local accounts), LOCAL_CHECKOUT_TTL_SECONDS
│   ├── constructs/src/
│   │   ├── core/stripe-secrets.ts              # the two Secrets Manager secrets (+ test)
│   │   ├── app/apis/stripe-webhook-api.ts      # hand-written: REST API, POST /stripe/webhook, WAF, no authorizer (+ test)
│   │   ├── app/apis/core-api.ts                # CORE_API_DEDICATED_FUNCTIONS gains PaymentsCheckout
│   │   ├── app/apis/admin-api.ts                # (generated by #283 or this feature) + a dedicated-function mechanism; ADMIN_API_DEDICATED_FUNCTIONS gains PaymentsConnect
│   │   └── app/lambda-functions/events-stripe-webhook.ts   # generator-owned wrapper
│   ├── infra-config/src/stages.types.ts        # + payments component config; stages.config.ts relaxes WAF/KMS for development only
│   └── scripts/                                 # reset-local-data also deletes tmp/local-dev/secrets/ (the stand-in's state is in memory)
├── databases/core-table/src/
│   ├── entities/order.ts                       # new entity (+ index.ts, service.ts) (+ test)
│   ├── entities/course.ts                      # + priceAmount, priceCurrency, pricedAt
│   ├── entities/enrolment.ts                   # + orderId
│   ├── entities/payment-connection.ts          # new singleton entity (+ index.ts, service.ts) (+ test)
│   ├── entities/payment-change.ts              # new audit entity (+ test)
│   └── helpers/
│       ├── order.ts                            # startOrder, attachCheckoutSession, findOpenOrder, settleOrderPaid, expireOrder, refundOrder (+ test)
│       ├── payment-connection.ts               # getConnection, beginChange (lease), completeConnection, rotateKey, completeDisconnect, abandonChange, recordChange, listChanges (+ test)
│       ├── invariants.ts                       # widened and new checks (+ tests)
│       └── progress-stream.test.ts, search-stream.test.ts
├── events/src/
│   ├── payments/stripe-webhook.ts              # handleStripeWebhook(rawBody, signature): verify, route, answer (+ test)
│   ├── payments/stripe-webhook-handler.ts      # Lambda entry (API Gateway proxy event) (+ test)
│   ├── payments/events/*.ts                    # one file per event type: session-completed, session-expired, charge-refunded (+ tests)
│   ├── local/stripe-stand-in.ts                # the stand-in: API, accounts, webhook endpoints, pay page, signed delivery, test controls (+ test)
│   └── search/course-document.ts               # + priceAmount, priceCurrency
├── apis/
│   ├── core-api/src/
│   │   ├── procedures/payment.ts               # checkout, available (+ test)
│   │   ├── procedures/enrolment.ts             # enrol: priced course refused in the same transaction (+ test)
│   │   ├── schema/payment.ts, schema/course.ts # price on public course output, enrolment `orderId` not exposed
│   │   └── router.ts                           # payment router (+ router.test.ts)
│   ├── instructor-api/src/procedures/course.ts # setPrice (refused for non-zero when not connected); create sets price 0 (+ test)
│   └── admin-api/src/procedures/payment.ts     # status, connect, disconnect (+ test); PaymentsConnect function entry
├── infra/src/
│   ├── stacks/data-stack.ts                    # Stripe secrets (stateful)
│   ├── stacks/payments-stack.ts                # webhook API + Lambda (new stack); exports the webhook URL
│   ├── stacks/admin-api-stack.ts               # (new with #283 or here) PaymentsConnect grants: write on both secrets, STRIPE_WEBHOOK_URL
│   ├── stacks/core-api-stack.ts                # checkout function grants (API key read), env vars
│   └── stages/application-stage.ts             # Payments stack in order: Data -> Payments -> CoreApi ... AdminApi ... RuntimeConfig
├── websites/
│   ├── student-portal/src/routes/learn/$courseId/-components/enrolment-actions.tsx   # price, Buy now, confirming state
│   ├── student-portal/src/routes/search/ and -components/                             # price on catalogue cards
│   ├── instructor-portal/src/routes/_authenticated/my-courses_/$courseId/-components/course/course-price-form.tsx
│   └── admin-portal/src/routes/payments.tsx + components/payments/  # the Payments page; sidebar entry
├── e2e/src/
│   ├── scenarios/payment.e2e.ts, scenarios/refund.e2e.ts, scenarios/payment-connection.e2e.ts
│   ├── concurrency/payment-webhook.e2e.ts
│   └── helpers/payment.ts, helpers/stripe-stand-in.ts (connectStripeStandIn signs in as Carol and calls payment.connect)
docs/src/content/docs/en/                        # design page, learner/instructor/operator guide
CLAUDE.md, CONTRIBUTING.md                       # one sentence each; stand-in row in the local services table
```

**Structure Decision**: extend existing packages; the new deployable pieces are the webhook Lambda (in `packages/events`, where the other AWS-triggered handlers live), its small construct and stack, and the `PaymentsConnect` function inside the shared `admin-api`. The Stripe client and secret reading are used by core-api and events, so they live in `common-server-utils` (constitution VIII). The order lifecycle is used by core-api and events, so it lives in `core-table` helpers.

**Amendment 2026-11-19, files touched** (all existing; no new package, construct or stack): `core-table/src/entities/order.ts`, `helpers/order.ts`, `helpers/invariants/payments.ts`, `helpers/notification-types.ts` (and their tests); `core-api/src/procedures/payment.ts`, `procedures/enrolment.ts` and `schema/`; `events/src/payments/events/charge-refunded.ts`; `student-portal/src/routes/learn/$courseId/-components/enrolment-actions.tsx`; `e2e/src/scenarios/learner-refund.e2e.ts`, `scenarios/leave-course.e2e.ts`, `concurrency/refund-request.e2e.ts`; the payments design page and the student guide. `requestRefund` joins `payment.checkout` on the `PaymentsCheckout` dedicated function; `payment.myOrder` and `course.unenrol` run on the shared core-api function.

## Risks

- **R1: `common-web-utils/price` imported by backends.** The package is "non-UI code shared by portals" and a Biome rule stops the portals importing server-utils, not the reverse. T002 confirms no rule forbids a backend importing it; if one does, move the module to `core-table/helpers` and give the portals a generated copy of the constants through the course schema instead.
- **R2: stand-in fidelity.** The `stripe` SDK speaks form-encoded requests and expects specific response shapes. The stand-in implements only `checkout.sessions.create`, `payment_intents.retrieve`, `refunds.create` and `webhookEndpoints`-free signing, and its contract file lists exactly those. Differences from real Stripe (3-D Secure, async methods, tax) are the `(human)` deployed check's job.
- **R3: duplicate pending orders.** Two simultaneous Buy now clicks can create two orders and sessions. Both being paid is handled by the automatic refund, not prevented, so there is no lock record (R-4).
- **R4: search index mapping.** If the OpenSearch index mapping is strict, adding fields to the course document needs a mapping change and a reindex. T021 reads the index definition in `packages/common/constructs/src/core/opensearch.ts` and `packages/events/src/search/` first.
- **R5: refund races a re-purchase.** A refund notice delayed past a re-purchase must not end the new enrolment: the enrolment write is conditioned on `orderId` equalling the refunded order's.
- **R6: unmatched payments are only logged.** An operator must see them: a metric filter and alarm on the log line is out of scope here and listed in the docs as a manual check; the log carries the Stripe session id.
- **R8: `admin-api` is not on `main` yet.** Both #283 and #279 depend on it too. If this feature's admin phase starts first it generates it, and whoever merges second reuses it: the phase's first task checks `main` and `generator-guide`, and the PR says which happened. The Phase that needs it is last in the story order, so checkout and pricing can ship and be tested with the connection written through the same procedures called directly in tests; an operator cannot connect Stripe on a deployed stage until the admin phase merges, so the PR for the checkout phases must not let a price be set on a deployed stage before then (tasks.md's existing rule, extended).
- **R9: contention on the connection record.** Every checkout updates one item. Checkout volume (a handful per minute) is far below a partition's write limit; the optimistic retry (3 attempts) covers collisions. If a load test shows otherwise the running maximum can move to a per-day bucket.
- **R10: late confirmations after a switch.** Stripe retries failed deliveries for days. A payment completed within the last hour before a switch is blocked from switching by the open-checkout window while its session is live, but a confirmation Stripe could not deliver for hours (the endpoint was failing) could arrive after a switch and be rejected. The docs tell administrators to check for failing deliveries in Stripe's dashboard before switching accounts, and the page notes it.
- **R11: restricted-key permissions are unconfirmed.** Whether a restricted key may call `accounts.retrieve()` and `webhookEndpoints.create` must be confirmed against Stripe's test mode; until then the page documents the secret key and treats a permission error as an ordinary refusal (R-14 open point).
- **R12: a crash mid-switch leaves `changing`.** The lease expires in two minutes and the next save takes over (R-15); `abandonChange` releases it on a handled failure. Between the lease and its expiry checkout is refused ("unavailable right now"), which is deliberate.
- **R7: pending orders whose Stripe `expired` event never arrives.** They stay `pending` after `expiresAt`; every reader treats a pending order past its `expiresAt` as closed, and no invariant requires them to be `expired`.

- **R13: a requested refund whose confirmation never arrives.** Stripe refunded, the order shows "Refund requested", and the student still has access. Stripe retries a failed delivery for days, so this needs the webhook to be failing that long; the page keeps saying requested and nothing is lost. The docs tell an operator to look for `paid` orders with an old `refundRequestedAt`. No sweeper is added.
- **R14: Stripe refuses the refund** (a dispute is open, the charge is too old for the card network, the balance cannot cover it). The call fails before anything is written, the student sees "Couldn't request the refund", and the error is logged with the order ID for an operator. A restricted key needs refund write permission, which the automatic refunds of R-4 already need (R11).
- **R15: refunds requested after a payout.** Not a risk in this feature (the platform holds the money), but #286 pays instructors: a refund inside the 14 days must come out of earnings not yet paid, so #286 should not pay out an order's share before its refund period ends. Noted for that spec, with `refundRequestedAt` and `REFUND_WINDOW_DAYS` as the fields to read.
- **R16: `dropped` no longer means refunded.** Any text or figure that equates the two is now wrong: the course page's `dropped` row (rewritten in T107), the instructor analytics label for dropped enrolments, and the design docs. T107 and T112 check each; the invariants never made the equation, except through `orderId`, which is unchanged.
- **R17: serial refunders.** A student can buy, use a course for up to 14 days without completing it, refund, and buy again later with a fresh period. Accepted for now: the terms are deliberately simple, an operator can see the pattern in Stripe, and a limit on repeat refunds of the same course is a small follow-up in `refundEligibility`.

## Constitution re-check after the amendment's design

All eight principles still pass (table above is updated in place): no new service (one more function in an API that is planned anyway), Secrets Manager stays the only home of credentials, the local store keeps the whole flow runnable without AWS, the admin function is the single writer, and no scan or new index is needed (the connection is a singleton, the audit is one partition). The only hand-written pieces are the dedicated-function mechanism in admin-api and the entities, as elsewhere.

**Re-check after the 2026-11-19 amendment's design.** All eight principles still pass. I: no new service or function; one more Stripe call from a function that already calls Stripe. II: nothing is scaffolded, so no generator applies. III: the stand-in already implements `refunds.create` and delivers `charge.refunded`, so both stories run locally with no account. IV: unit tests for the helpers and procedures, breaking tests for the widened `order-shape`, two e2e scenarios and a concurrency test (T089 to T111); impact check above. V: one optional attribute, no new index, no scan. VI: `requestRefund` acts only on the caller's own order, found through their own enrolment, returns no Stripe field, and the key is still read by the one dedicated function; `payment.myOrder` returns only the caller's order. VII: `refundRequestedAt` is optional and absent on existing orders by meaning, not by fallback. VIII: helpers stay in `helpers/order.ts`, a verb-named function runs its own I/O, buttons are text only.

## Complexity Tracking

*No constitution violations.*
