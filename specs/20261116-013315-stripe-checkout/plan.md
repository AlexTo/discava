# Implementation Plan: Stripe Checkout for Paid Courses

**Branch**: `20261116-013315-stripe-checkout` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261116-013315-stripe-checkout/spec.md`

## Summary

A course gains a required price (amount in minor units plus currency; zero is free). core-api's `course.enrol` refuses a priced course, and a new `payment.checkout` procedure records a pending `order` and returns a Stripe-hosted Checkout URL. A new webhook Lambda, behind its own API Gateway, verifies Stripe's signature and, on `checkout.session.completed`, runs one `core-table` helper that marks the order paid and creates (or restores) the enrolment in one transaction. `checkout.session.expired` closes the order; `charge.refunded` records the refund and, for a full refund, ends the enrolment with the existing `dropped` status. Undeliverable payments (already enrolled, course no longer published) are refunded automatically. Stripe keys live in two Secrets Manager secrets. Locally, a Stripe stand-in in the event runner (hosted pay page, the slice of Stripe's API used, correctly signed webhooks, test controls for duplicates and refunds) takes the place of Stripe, selected by `LOCAL_DEV=true` like S3Mock and the local OIDC server.

What the code showed that the spec could not:

1. **Enrolment is one transaction in `course.enrol`** (`packages/apis/core-api/src/procedures/enrolment.ts`): a `check` that the course is `published` plus an `enrolment.create`. The paid rule belongs in that same transaction (`priceAmount = 0` joins the check), so a price set at the same moment cannot be raced, and the failure reasons already distinguish "course not available" from "already enrolled".
2. **`dropped` has no writer today**, but every reader already treats it as not enrolled: `requireEnrolment`, `my-enrolments`, the progress recalculation, `studentActivityWrites`' `lastActivityAt` write, and the portal's enrolment actions. Ending an enrolment with it needs no new access check anywhere. The two places that tie `completedAt` to `completed` (the `completed-at-iff-completed` and `certificate-has-completed-enrolment` invariants) do need widening, because a refunded, completed student keeps `completedAt`.
3. **The webhook cannot be a tRPC procedure.** Stripe signs the raw body and sends no Cognito token. `PUBLIC_OPERATIONS` skips the authorizer for tRPC operations but still parses JSON bodies through the router. The webhook is its own Lambda behind its own API Gateway method, and shares no function with signed-in code (FR-021).
4. **Local dev has one event runner on port 2024** that already stands in for MediaConvert, Scheduler, the table stream and Cognito's trigger. The Stripe stand-in lives there too and mounts the same handler function the deployed Lambda wraps, so local runs exercise the real verification and fulfilment code.
5. **The course search document** (`packages/events/src/search/course-document.ts`) lists course fields by name, so the price must be added there for catalogue cards to show it. The catalogue-categories spec (#283) adds fields to the same document; the two touch different lines and neither blocks the other.

## Technical Context

**Language/Version**: TypeScript (Node 22+ Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC + zod, ElectroDB (`@discava/core-table`), the official `stripe` Node SDK (new, pinned, in core-api, events and `common-server-utils/stripe`), AWS SDK Secrets Manager client (`@aws-sdk/client-secrets-manager`), TanStack Router/Query, shadcn (`@discava/common-shadcn`), `@discava/common-web-utils` (new `price` module)

**Storage**: the one core table; new `order` entity; `course` gains `priceAmount`, `priceCurrency`, `pricedAt`; `enrolment` gains `orderId`. Two new Secrets Manager secrets

**Testing**: vitest per project (with the `@discava/core-table` alias), core-table `helpers/invariants.ts`, instructor and student portal component tests, Playwright e2e in `packages/e2e` including `src/concurrency/`, CDK synth/assertion tests in `packages/infra` and constructs

**Target Platform**: AWS Lambda + API Gateway + CloudFront + Secrets Manager; `pnpm dev` with Docker locally

**Project Type**: web application: serverless backend + React portals

**Performance Goals**: enrolled within 30 s of payment (Stripe delivers within seconds; the Lambda does a handful of keyed reads and one transaction); checkout creation under 2 s (one Stripe API call)

**Constraints**: no second table; no scans in user requests; no secret outside Secrets Manager; the webhook shares no function with signed-in APIs; stacks under 500 resources; no compatibility code for old data (price attributes required, backfilled by hand)

**Scale/Scope**: one order per checkout attempt; a handful of writes per purchase

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | Lambda, API Gateway, DynamoDB, Secrets Manager. Stripe is an external SaaS the issue names; it is called over HTTPS and adds no pluggable backend: there is no payment-provider abstraction, the code speaks Stripe |
| II. Generators first | Pass, with one hand-written piece | The webhook Lambda wrapper is generated with the `ts#lambda-function` generator into `packages/events` like the other handlers (T-task confirms the generator command with `generator-guide`). The checkout procedure extends core-api by hand-adding a procedure, as every procedure is. No generator fits "API Gateway method with a raw-body Lambda and no authorizer": `ts#trpc-api` generates tRPC APIs, so the `StripeWebhookApi` construct is hand-written, small, and the plan says so here. The secrets are plain CDK `Secret`s |
| III. Everything runs locally | Pass | The Stripe stand-in in the event runner replaces Stripe and its webhook delivery; secrets come from `common-server-utils/local-dev` constants, not Secrets Manager. Documented exception: Stripe's own hosted page, 3-D Secure and real card behaviour run only against Stripe's test mode on a deployed stage (a `(human)` task) |
| IV. Layered tests | Pass, planned | Unit tests for every helper, procedure, the webhook handler and the stand-in; invariants with breaking tests (below); an e2e scenario; a concurrency test. Impact check below |
| V. Single-table via ElectroDB | Pass | One entity (`order`); access patterns in [data-model.md](./data-model.md), all keyed, no scan, no new index: the existing `gsi1pk-gsi1sk-index` serves "a student's orders for a course". Stream consumers considered below |
| VI. Secure by default | Pass | Webhook verifies signatures, sits behind WAF and throttling that default to on, and its function has only the table and the two secrets; the checkout function reads only the API key; secrets are KMS-encrypted per stage config. Only `discava-development` relaxes WAF and KMS in `stages.config.ts` |
| VII. Change freely before launch | Pass | `priceAmount` and `priceCurrency` are required attributes backfilled by hand, with no fallback for a missing value; no redirects or aliases |
| VIII. Repo conventions | Pass | `core-table/src/helpers/order.ts`; price rules in `common-web-utils/price`; Stripe modules in `common-server-utils/src/stripe/` named for what they cover; text-only buttons, docs in English with translation noted |

No violations, so Complexity Tracking is empty.

**Impact check (constitution IV).** Shared records the feature writes or reads in a new way:

| Record | Use | Existing invariants and tests that already cover it | What changes |
|--------|-----|------------------------------------------------------|--------------|
| `enrolment` | Written by two new paths: the webhook's `settleOrderPaid` (create, or restore a `dropped` one) and the refund path (`endEnrolmentForRefund`: status to `dropped`). `course.enrol` still writes free enrolments. Gains `orderId` | `enrolment-in-published-course`, `completed-at-iff-completed`, `progress-matches-completions`, `student-records-enrolled`, `last-activity-at-current`, `certificate-has-completed-enrolment` | `completed-at-iff-completed` is **widened**: for an enrolment, `completedAt` set means `completed` or `dropped`, and `completed` still needs `completedAt` (its breaking tests are kept and extended with the new accepted case and the new refused case: `active` with `completedAt`). `certificate-has-completed-enrolment` is **widened**: a certificate's enrolment may be `dropped` with the same `completedAt`. `enrolment-in-published-course` already skips `dropped`. `last-activity-at-current` and `progress-matches-completions` do not look at status beyond `dropped`. Restoring writes the status the record already had (`completed` when `completedAt` is set, else `active`), so no check sees a new state |
| `course` | Read: `priceAmount`, `priceCurrency`, `status` (checkout, enrol, fulfilment). Written: price fields, only by instructor-api's `course.setPrice` | `course-has-instructor`, `instructor-course-updated-at`, `published-at-set` | `instructor-course-updated-at` stays satisfied: `setPrice` moves `updatedAt` and each instructor's `courseUpdatedAt` like other edits (its breaking test is extended). New `price-shape` check |
| `certificate` | Not written. A refund leaves it | `certificate-shape`, `certificate-has-completed-enrolment` | The widened check above |
| `order` (new) | Written by core-api (create pending, attach session) and the webhook (paid, expired, refunded) | none yet | New checks: `order-shape`, `paid-order-has-enrolment`, `enrolment-order-matches`, `paid-course-enrolment-paid`. `student-records-*`, `activity-count-matches-students` do not apply: an order is not student activity on an item and does not count towards `studentActivityCount` (a test pins it) |
| `itemCompletion`, `progress`, `quizAttempt`, assignment records | Untouched. A refunded student keeps them | `student-records-enrolled` already tolerates `dropped` enrolments ("enrolments are kept when a student drops out") | None |
| `user` | Not read. Orders are keyed by Cognito `sub` | `instructor-has-user` | None |
| Stream consumers | `order` inserts and modifies must match neither `PROGRESS_STREAM_FILTERS` nor `SEARCH_STREAM_FILTERS`. An enrolment MODIFY (restore, end) matches neither today. A `course` MODIFY of the price matches the search filter and re-indexes the same document with the price: wanted | `progress-stream.test.ts`, `search-stream.test.ts` | Add an assertion for each that an `order` write matches neither; add a search-stream case that a price-only course MODIFY is re-indexed. Restoring an enrolment does not trigger a progress recalculation (enrolment writes never do); progress is recomputed on the student's next activity or the next curriculum change, as for a new enrolment |

## Design Decisions (detail in [research.md](./research.md))

1. **State-based idempotence, no event log.** Every order move is conditioned on the status it comes from. A replayed, duplicated or concurrent confirmation finds the work done and does nothing; the handler still answers success (research R-1).
2. **Fulfilment is one transaction.** `settleOrderPaid` writes the order (`pending` to `paid`), the enrolment (create, or restore from `dropped`) and checks the course is `published`, together. A transaction cancelled by a failed condition is re-read and decided again, up to three times (R-2).
3. **Refund ends the enrolment with `dropped`**, keeps `completedAt`, progress and certificates; re-purchase restores it. `orderId` on the enrolment names the order that currently entitles it (R-3).
4. **Undeliverable payments are refunded by the handler**, with a Stripe idempotency key per order, then the order moves `pending` to `refunded` with a reason (R-4).
5. **One webhook function, own API Gateway, own stack**, built from a hand-written `StripeWebhookApi` construct; two secrets for least privilege (R-5, R-6).
6. **Stripe stand-in in the event runner**, speaking the slice of Stripe's HTTP API the code uses, so the real `stripe` SDK runs unchanged against it via host/port settings (R-7).
7. **Price handling**: integers in minor units, one shared module `common-web-utils/price` (currencies, bounds, validation, formatting) used by instructor-api, core-api and the portals; orders carry `listAmount` and `amount` apart (R-8).
8. **Grandfathering by `pricedAt`**: the time the price last became non-zero is on the course; an unpaid enrolment is legitimate only if it is older than that (with a 10 s skew allowance) (R-9).
9. **Card-only, one-hour sessions, polling return page**, per the Clarifications (R-10).

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
│   │   ├── stripe/secrets.ts                   # getStripeApiKey(), getStripeWebhookSecret() (+ test)
│   │   └── local-dev.ts                        # LOCAL_STRIPE settings (port, local keys, webhook secret)
│   ├── constructs/src/
│   │   ├── core/stripe-secrets.ts              # the two Secrets Manager secrets (+ test)
│   │   ├── app/apis/stripe-webhook-api.ts      # hand-written: REST API, POST /stripe/webhook, WAF, no authorizer (+ test)
│   │   ├── app/apis/core-api.ts                # CORE_API_DEDICATED_FUNCTIONS gains PaymentsCheckout
│   │   └── app/lambda-functions/events-stripe-webhook.ts   # generator-owned wrapper
│   ├── infra-config/src/stages.types.ts        # + payments component config; stages.config.ts relaxes WAF/KMS for development only
│   └── scripts/                                 # reset-local-data also clears the stand-in's state if it persists (T-task)
├── databases/core-table/src/
│   ├── entities/order.ts                       # new entity (+ index.ts, service.ts) (+ test)
│   ├── entities/course.ts                      # + priceAmount, priceCurrency, pricedAt
│   ├── entities/enrolment.ts                   # + orderId
│   └── helpers/
│       ├── order.ts                            # startOrder, attachCheckoutSession, findOpenOrder, settleOrderPaid, expireOrder, refundOrder (+ test)
│       ├── invariants.ts                       # widened and new checks (+ tests)
│       └── progress-stream.test.ts, search-stream.test.ts
├── events/src/
│   ├── payments/stripe-webhook.ts              # handleStripeWebhook(rawBody, signature): verify, route, answer (+ test)
│   ├── payments/stripe-webhook-handler.ts      # Lambda entry (API Gateway proxy event) (+ test)
│   ├── payments/events/*.ts                    # one file per event type: session-completed, session-expired, charge-refunded (+ tests)
│   ├── local/stripe-stand-in.ts                # the stand-in: API, pay page, signed delivery, test controls (+ test)
│   └── search/course-document.ts               # + priceAmount, priceCurrency
├── apis/
│   ├── core-api/src/
│   │   ├── procedures/payment.ts               # checkout (+ test)
│   │   ├── procedures/enrolment.ts             # enrol: priced course refused in the same transaction (+ test)
│   │   ├── schema/payment.ts, schema/course.ts # price on public course output, enrolment `orderId` not exposed
│   │   └── router.ts                           # payment router (+ router.test.ts)
│   └── instructor-api/src/procedures/course.ts # setPrice; create sets price 0 (+ test)
├── infra/src/
│   ├── stacks/data-stack.ts                    # Stripe secrets (stateful)
│   ├── stacks/payments-stack.ts                # webhook API + Lambda (new stack)
│   ├── stacks/core-api-stack.ts                # checkout function grants (API key read), env vars
│   └── stages/application-stage.ts             # Payments stack in order: Data -> Payments -> CoreApi ... RuntimeConfig
├── websites/
│   ├── student-portal/src/routes/learn/$courseId/-components/enrolment-actions.tsx   # price, Buy now, confirming state
│   ├── student-portal/src/routes/search/ and -components/                             # price on catalogue cards
│   └── instructor-portal/src/routes/_authenticated/my-courses_/$courseId/-components/course/course-price-form.tsx
├── e2e/src/
│   ├── scenarios/payment.e2e.ts, scenarios/refund.e2e.ts
│   ├── concurrency/payment-webhook.e2e.ts
│   └── helpers/payment.ts, helpers/stripe-stand-in.ts
docs/src/content/docs/en/                        # design page, learner/instructor/operator guide
CLAUDE.md, CONTRIBUTING.md                       # one sentence each; stand-in row in the local services table
```

**Structure Decision**: extend existing packages; the only new deployable pieces are the webhook Lambda (in `packages/events`, where the other AWS-triggered handlers live), its small construct, and one stack. The Stripe client and secret reading are used by core-api and events, so they live in `common-server-utils` (constitution VIII). The order lifecycle is used by core-api and events, so it lives in `core-table` helpers.

## Risks

- **R1: `common-web-utils/price` imported by backends.** The package is "non-UI code shared by portals" and a Biome rule stops the portals importing server-utils, not the reverse. T-task confirms no rule forbids a backend importing it; if one does, move the module to `core-table/helpers` and give the portals a generated copy of the constants through the course schema instead.
- **R2: stand-in fidelity.** The `stripe` SDK speaks form-encoded requests and expects specific response shapes. The stand-in implements only `checkout.sessions.create`, `payment_intents.retrieve`, `refunds.create` and `webhookEndpoints`-free signing, and its contract file lists exactly those. Differences from real Stripe (3-D Secure, async methods, tax) are the `(human)` deployed check's job.
- **R3: duplicate pending orders.** Two simultaneous Buy now clicks can create two orders and sessions. Both being paid is handled by the automatic refund, not prevented, so there is no lock record (R-4).
- **R4: search index mapping.** If the OpenSearch index mapping is strict, adding fields to the course document needs a mapping change and a reindex. T-task reads the index definition in `packages/common/constructs/src/core/opensearch.ts` and `packages/events/src/search/` first.
- **R5: refund races a re-purchase.** A refund notice delayed past a re-purchase must not end the new enrolment: the enrolment write is conditioned on `orderId` equalling the refunded order's.
- **R6: unmatched payments are only logged.** An operator must see them: a metric filter and alarm on the log line is out of scope here and listed in the docs as a manual check; the log carries the Stripe session id.
- **R7: pending orders whose Stripe `expired` event never arrives.** They stay `pending` after `expiresAt`; every reader treats a pending order past its `expiresAt` as closed, and no invariant requires them to be `expired`.

## Complexity Tracking

*No constitution violations.*
