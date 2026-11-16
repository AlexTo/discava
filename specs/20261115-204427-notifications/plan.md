# Implementation Plan: In-App and Email Notification Pipeline

**Branch**: `20261115-204427-notifications` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261115-204427-notifications/spec.md`

## Summary

A shared pipeline other features publish to. Producers call one `core-table` helper (`notificationWrites`, or `publishNotification` standalone, or `notifyCourseStudents` for a whole course) with an event type from one registry, a recipient, flat string parameters, a dedupe key and the event's own time. The helper validates, then writes a `notification` record and bumps the user's unread counter in a transaction the producer can join. Creation is deterministic (the key is derived from type and dedupe key), so a retried publish is a no-op. core-api gains a `notification` router (list, unread count, mark read, mark all read, preferences) and the three portals gain one shared bell and a settings page.

Email is a separate, stream-triggered step: a new `notification-delivery` Lambda (in `packages/events`, from the repo's own `ts#lambda-function` generator) reacts to INSERTs of `notification` (send the email) and `notificationBroadcast` (fan a course audience out to students). It claims each notification before sending (`pending` to `sending` to `sent`, `skipped`, `failed` or `unknown`), so a retry never sends twice, and sends through SES. Preferences are one record per user and type, read at delivery time. Every email carries an HMAC-signed, per-user-per-type unsubscribe link (page plus RFC 8058 one-click POST). Locally the event runner runs the same handler and a local sender captures emails to a git-ignored folder, shown on an inbox page at the runner's port.

Facts the repo showed that shaped the plan:

1. The core table already has a stream with `NEW_AND_OLD_IMAGES`, and `PROGRESS_STREAM_FILTERS` / `SEARCH_STREAM_FILTERS` plus `DynamoEventSource` mappings (own DLQ each) in `CoreApiStack`, and the event runner applies the same filters locally. The stream event router spec (`specs/20261116-183449-stream-event-router`) puts one router Lambda on the stream and a queue, failure queue and alarm per feature. Notifications follow it: `NOTIFICATION_STREAM_FILTERS` becomes the filters of one `notification-delivery` registration in `STREAM_FEATURES`, and there is no mapping or DLQ of its own.
2. `core-api` has `PUBLIC_OPERATIONS` (a method that skips the Cognito authorizer, with its own tighter throttle) but only for tRPC procedures. A one-click unsubscribe needs a plain `POST` that is not a tRPC call, so the plan adds one non-tRPC public route to the CoreApi construct (research R-6).
3. Enrolments are keyed pk `courseId`, sk `userId`, with `status` of `active`, `completed` or `dropped`: a course audience is a keyed range query, no index needed.
4. `user` records hold `email`, `givenName` and `familyName` (kept by the pre-token-generation trigger, also run locally), so delivery needs no Cognito call.
5. Stage config (`stages.config.ts`) takes per-stage options and env overrides; the sender and SES identity are per account, so they come from there and never from the repository.

## Technical Context

**Language/Version**: TypeScript (Node 24 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: ElectroDB (`@discava/core-table`), tRPC + zod (core-api), `@aws-sdk/client-sesv2` (new, `common-server-utils` and `events`), `node:crypto` (HMAC), TanStack Router/Query, shadcn (`@discava/common-shadcn`), CDK (`aws-cdk-lib/aws-ses`-free: only an IAM grant and a Secrets Manager secret)

**Storage**: the one DynamoDB core table; four new entities (`notification`, `notificationState`, `notificationPreference`, `notificationBroadcast`); no new table, no new index

**Testing**: vitest per project (with the `@discava/core-table` alias), core-table `helpers/invariants.ts` checks, portal component tests (Testing Library), Playwright e2e in `packages/e2e` with `src/concurrency/`

**Target Platform**: AWS Lambda, API Gateway, DynamoDB Streams, SES, Secrets Manager (deployed); `pnpm dev` with Docker (DynamoDB local, event runner) locally, no AWS account

**Project Type**: web application: serverless backend (core-table, core-api, events, infra) and three React portals

**Performance Goals**: bell count visible within 60 s of publish (poll interval); email sent within about one minute (stream batching window 5 s). A producer's publish adds one keyed read and two transaction items to its own request.

**Constraints**: no second table; keys only for user-facing requests (no scans; invariant checks may scan); least-privilege per function (only `notification-delivery` and the unsubscribe function get SES or the token secret); CloudFormation 500-resource cap per stack (CoreApi gains two functions, one event source, one queue, a route); SES sandbox and sender verification are manual account steps

**Scale/Scope**: one notification per user per event; courses of thousands of students; a user's unread count is small in practice and mark-all-read is bounded per call

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | SES, Lambda, DynamoDB Streams, Secrets Manager, API Gateway; nothing pluggable (no "email provider" interface: SES is called directly behind a local switch) |
| II. Generators first | Pass | No new project. The two new Lambdas (`notification-delivery`, `notification-unsubscribe`) are created with the `ts#lambda-function` generator, as every `events-*` wrapper in `constructs/src/app/lambda-functions` was. The shared bell is a hand-written component in the existing `common-shadcn` project (no generator scaffolds components). The non-tRPC unsubscribe route is hand-written because no generator adds one |
| III. Everything runs locally | Pass | The event runner's router and feature runner run the delivery handler from the `notification-delivery` queue (ElasticMQ) with the same registration; a local sender captures email to `tmp/local-dev/emails/` and serves an inbox on the runner's port 2024; the token secret is a fixed dev constant behind `LOCAL_DEV`; core-api's local server serves the unsubscribe route |
| IV. Layered tests | Pass, planned | Unit tests per helper, procedure, handler, sender and token code; new invariants with breaking tests; `notification.e2e.ts` and a concurrency test for racing duplicate publishes and mark-read; portal component tests |
| V. Single-table via ElectroDB | Pass | Access patterns below, all keys; stream filters added (`NOTIFICATION_STREAM_FILTERS`); existing consumers checked in the impact check (progress and search ignore the new entities) |
| VI. Secure by default | Pass | Token secret in Secrets Manager (KMS per the Data stack's defaults); SES permission scoped to the configured identity; unsubscribe route public but throttled by `publicThrottle`, constant-time token check, per-user-per-type scope; a notification's link carries no secrets |
| VII. Change freely before launch | Pass | New entities, no compat layer; the registry and record shapes can change outright |
| VIII. Repo conventions | Pass | Helpers in `core-table/src/helpers/notification*.ts` (one file per topic); shared email and token code in `common-server-utils` modules (`email.ts`, `unsubscribe-token.ts`); text-only buttons (the bell is an icon-only control, allowed); English docs only if added, translations noted |

Impact check, shared records, per Constitution IV, is in [data-model.md](./data-model.md#impact-check). Summary: this feature writes only its own four entities and reads `enrolment` (audience, keyed range) and `user` (address, keyed get); it changes no counted or related record's meaning, so no existing invariant is extended, and four are added.

Complexity Tracking is empty.

**Re-check after design:** still passing. Judgment calls: one non-tRPC public route (R-6), and `packages/events` holding a Lambda that serves an API route (the unsubscribe handler shares code with delivery; kept in `events` because it is a standalone handler, not router code).

## Design Decisions (detail in [research.md](./research.md))

1. **Deterministic creation = idempotency.** `id = sha256(type, dedupeKey)` (first 16 hex chars); the record's sort key is `<occurredAt>#<id>`. A transaction `create` with a not-exists condition means a duplicate publish cancels on that item. `publishNotification` treats exactly that cancellation as "already published"; a producer that joins `notificationWrites` into its own transaction gets the cancellation like any condition failure and handles it as it does its own (re-read, retry). `occurredAt` comes from the producer's own record so a retry reproduces the same key.
2. **Unread counter plus read-up-to watermark, in one `notificationState` record.** `unreadCount` rises in the same transaction that creates a notification. A notification is read when `readAt` is set or its position is at or before `readThrough`. Mark read patches one item and decrements; mark all read moves `readThrough` to a position the client was shown and decrements by a count taken from a bounded keyed range query (`readThrough` exclusive to the new position inclusive, items without `readAt`), conditioned on the state's `version` so a racing publish or mark-read retries it. A notification published later at or before `readThrough` is created already read and not counted (spec FR-012). No scan anywhere.
3. **Two producer entry points and one registry.** `notificationWrites(service, input)` (async: one keyed read of the state) returns transaction items; `publishNotification` runs them in its own transaction; `notifyCourseStudents` writes one `notificationBroadcast`. Event types live in `helpers/notification-types.ts`, each with flat string params, builders for title, body and link, and an email policy (`default-on`, `default-off`, `required` or `never`). Adding a type touches only that file and its test.
4. **Fan-out and delivery are stream-triggered, in one Lambda.** `notification-delivery` handles two entities from one registration filtered by `NOTIFICATION_STREAM_FILTERS` (INSERT of `notification` and of `notificationBroadcast`; MODIFY is not matched, so progress writes cannot loop). Fan-out pages the course's enrolments (not `dropped`), publishes per student with `publishNotification` (idempotent), and saves its page cursor on the broadcast so a retry resumes. Notifications it creates are themselves INSERTs, routed to the same feature queue. Delivery is at least once and unordered, which the handler's header comment says it tolerates (router FR-011).
5. **At-most-once email by claim-then-send.** The notification carries `email: { state, reason?, claimedAt?, sentAt?, messageId? }`, `pending` from creation. Delivery decides skip reasons first (`not-configured`, `opted-out`, `no-address`, `never`), claims with a conditional patch `pending` to `sending`, sends, then records `sent`. A duplicate invocation that loses the claim reads the record: done states end it, a fresh `sending` retries later, and a `sending` older than the lease (5 minutes) becomes `unknown` and is never resent. Transient SES errors release the claim back to `pending` and throw (the queue redelivers); permanent ones record `failed`.
6. **Preferences are one record per user and type** (`notificationPreference`, pk `userId`, sk `type`), absent meaning the registry default. Delivery reads one by key; settings reads the user's range. `required` types ignore the record.
7. **Unsubscribe token**: `base64url(userId) . type . base64url(HMAC-SHA256(secret, userId + "\n" + type))`, no expiry (old emails keep working), constant-time compare. The portal's `/unsubscribe` page shows the type and a button; a non-tRPC public route `GET /unsubscribe/{token}` (describe, no change) and `POST /unsubscribe/{token}` (apply; also accepts the RFC 8058 `List-Unsubscribe=One-Click` body) is served by the `notification-unsubscribe` Lambda. The emails' `List-Unsubscribe` header is that URL.
8. **Email is plain.** One shared layout (text and HTML) from title, body, link and reason; all user text escaped; no template engine, no digests.
9. **Local stand-in.** `common-server-utils/email.ts` exports `sendEmail`, switching on `LOCAL_DEV=true`: locally it posts to the event runner's `POST /emails` (which writes `tmp/local-dev/emails/<ts>-<id>.json`), deployed it calls SES v2. The runner serves `GET /emails` (JSON) and `GET /inbox` (a plain HTML list and detail view). `reset-local-data` clears the folder.

## Access patterns (all keyed; no scans in a request)

| Pattern | Key |
|---|---|
| A user's notifications newest first, paged | `notification` pk `userId`, sk range, descending |
| Mark one read / publish (duplicate check) | `notification` get/create by `userId` + sk |
| Unread count, read-up-to | `notificationState` get by `userId` |
| Unread items in a range (mark all read) | `notification` pk `userId`, sk between `readThrough` and the shown position |
| One preference / all of a user's | `notificationPreference` get by `userId` + `type` / pk `userId` range |
| Course audience | `enrolment` pk `courseId` range (existing primary index) |
| Fan-out progress | `notificationBroadcast` get / patch by id |
| Address for email | `user` get by `userId` |
| Invariant checks | full scan, in tooling only (as the existing checks) |

## Project Structure

### Documentation (this feature)

```text
specs/20261115-204427-notifications/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── producer-helpers.md
│   ├── core-api-notification.md
│   ├── events-and-email.md
│   └── portal-ui.md
└── tasks.md             # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
packages/
├── databases/core-table/src/
│   ├── entities/
│   │   ├── notification.ts, notification-state.ts, notification-preference.ts, notification-broadcast.ts  (+ tests)
│   │   └── index.ts, service.ts            # register the four entities
│   └── helpers/
│       ├── notification-types.ts           # the registry (the public contract) (+ test)
│       ├── notification.ts                 # notificationWrites, publishNotification, notifyCourseStudents,
│       │                                   #   markNotificationRead, markNotificationsRead (+ test)
│       ├── notification-stream.ts          # NOTIFICATION_STREAM_FILTERS, matchesNotificationStreamFilters (+ test)
│       ├── notification-email.ts           # claim/skip/sent/failed transitions (+ test)
│       └── invariants.ts                   # + notification invariants (+ tests)
├── common/
│   ├── server-utils/src/
│   │   ├── email.ts                        # sendEmail: SES v2, or the local inbox when LOCAL_DEV (+ test)
│   │   ├── unsubscribe-token.ts            # sign / verify (+ test)
│   │   ├── unsubscribe.ts                  # handleUnsubscribe with injected store; used by the Lambda and core-api's local server (+ test)
│   │   └── local-dev.ts                    # local email endpoint, dev token secret, portal URLs
│   ├── constructs/src/app/
│   │   ├── lambda-functions/events-notification-delivery.ts, events-notification-unsubscribe.ts  # generator-owned
│   │   └── apis/core-api.ts                # the non-tRPC public /unsubscribe route
│   ├── infra-config/src/stages.types.ts    # notifications: { fromAddress?, sesIdentity? }
│   └── shadcn/src/components/notification-bell.tsx   # presentational bell, list, empty state (+ test)
├── apis/core-api/src/
│   ├── procedures/notification.ts          # list, unreadCount, markRead, markAllRead, preferences, setPreference (+ test)
│   ├── schema/notification.ts, router.ts
│   └── local-server.ts                     # serves /unsubscribe locally
├── events/src/
│   ├── notifications/
│   │   ├── delivery.ts                     # handler: routes records to fan-out or email (+ test)
│   │   ├── fan-out.ts, send-email.ts, email-template.ts (+ tests)
│   │   └── unsubscribe.ts                  # thin API Gateway handler over handleUnsubscribe (+ test)
│   └── local/event-runner.ts, email-inbox.ts   # feature runner runs delivery (registration, no batcher); POST /emails, GET /emails, GET /inbox
├── infra/src/stacks/
│   ├── data-stack.ts                       # token secret
│   └── core-api-stack.ts                   # delivery Lambda, SES grant, unsubscribe route (queue and mapping come from the router's registration)
├── common/scripts/src/                     # notify-local script; reset-local-data clears tmp/local-dev/emails
├── websites/{student,instructor,admin}-portal/src/
│   ├── components/NotificationBell.tsx     # wires core-api hooks into the shared bell
│   ├── routes/settings/notifications.tsx   # preferences
│   └── routes/unsubscribe.tsx              # student portal only (public page)
└── e2e/src/scenarios/notification.e2e.ts, concurrency/, helpers/
```

**Structure Decision**: extend existing packages; no new project. New shared modules exist because two or more Lambdas (delivery and unsubscribe, plus core-api's local server) use the token code, and two portals-plus use the bell.

## Risks

- **R1: SES setup is manual.** The sender identity must be verified, and a new account is in the SES sandbox (only verified recipients). `discava-development` needs it done before email can be checked on a deployed stage; tasks mark it `(human)`.
- **R2: stream retry and ordering.** Stream retries redeliver an INSERT; the claim makes that safe. A batch that always fails moves to the feature's failure queue after five receives, so a poison record never blocks the shard or other users. SQS cannot bisect, so it can carry its batch-mates with it; the handler's steps are idempotent, so redriving them is safe. The handler throws after finishing the other records and does not use per-item failures.
- **R3: a producer joining the transaction can be cancelled by the counter condition.** The state update is conditioned on the `version` read moments earlier; a concurrent mark-all-read or publish cancels it, and the producer retries like for any cancelled transaction. The helper's tests and the contract say so.
- **R4: mark-all-read over a very large unread backlog.** The range is processed in chunks of 500 items per call; the API returns whether more remain and the portal calls again. A state `version` conflict retries up to 3 times inside the call.
- **R5: stack resource limit.** CoreApi gains two functions, one route and grants; the queue, failure queue, alarm and mapping belong to the router stack. Check the count at synth.
- **R6: non-tRPC route in the API construct.** `CoreApi.defaultIntegrations` builds routes only from router operations. The route is added beside them; a spike task checks it with the construct's tests and checkov before building on it.
- **R7: spam and bounces.** Bounce and complaint handling are left to SES's account-level suppression list; a feedback-processing pipeline is out of scope and noted for a later issue.

## Complexity Tracking

*No constitution violations.*
