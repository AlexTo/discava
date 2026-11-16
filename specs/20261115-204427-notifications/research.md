# Research: In-App and Email Notification Pipeline

No `NEEDS CLARIFICATION` remained after clarify. This records what the codebase showed and the decisions that follow.

## R-1: Fan-out and delivery trigger

- **Decision**: the core table's stream, the core table's stream through the stream event router (the one stream consumer, which sends each change to a per-feature SQS queue), as a `notification-delivery` registration whose filters are a new `NOTIFICATION_STREAM_FILTERS` (INSERT of `notification` and `notificationBroadcast`, new image), applied identically by the event runner locally.
- **Found**: the stream is on with `NEW_AND_OLD_IMAGES`. The router spec (`specs/20261116-183449-stream-event-router`) moves progress and search behind one router Lambda because a DynamoDB stream should have at most two readers, and each feature is a `STREAM_FEATURES` entry in `core-table/src/helpers/stream-features.ts` that the deployed router stack and the local event runner both read. This feature was first written as a third direct mapping, which that spec replaces.
- **Rationale**: it is the repo's pattern and runs locally without change. The issue's "or EventBridge" is not needed: nothing is cross-service.
- **Alternatives**: EventBridge bus (rejected: a new local stand-in for no gain); send email inline in the producer's request (rejected: slow, not retry-safe, couples producers to SES); a third direct stream mapping (rejected: it would be the third reader of the stream; the router gives each feature a queue, failure queue and alarm from one registration); building our own SQS between (rejected: the router is that queue).
- **Constraint**: only INSERT is filtered in. The delivery handler patches the notification's email state (MODIFY), which must not re-trigger it.

## R-2: Idempotent creation and the sort key

- **Decision**: `id` = first 16 hex chars of `sha256(type + "\0" + dedupeKey)`; sort key `<occurredAt>#<id>`; create with a not-exists condition.
- **Rationale**: no extra marker records or index. A retry that supplies the same `occurredAt` and dedupe key lands on the same key. The producer must pass `occurredAt` (from its own record); `notificationWrites` rejects a missing one.
- **Alternatives**: a random id with a separate dedupe marker record (rejected: two writes and a second read pattern); a GSI on dedupe key (rejected: an index for a duplicate check); `occurredAt` defaulting to now (rejected: a retry would not collide; the spec's clarification makes it required).
- **Edge**: the same key with different parameters is ignored; the cancelled create is logged by `publishNotification`.

## R-3: Unread count without scanning

- **Decision**: a per-user `notificationState` with `unreadCount`, `readThrough` and a `version`. Publish: create item and increment in one transaction. Mark one: patch item `readAt` (condition: no `readAt`, position after `readThrough`) and decrement, both conditioned on the state's `version`. Mark all up to a shown position: bounded keyed range query, count items in `(readThrough, position]` without `readAt`, then one transaction moving `readThrough` and decrementing, conditioned on `version`.
- **Rationale**: spec FR-010 forbids computing the count by scanning the user's list; the watermark makes mark-all cost one write plus a bounded read. Read state is derived (`readAt` or position at or before `readThrough`), so mark-all does not rewrite items.
- **Alternatives**: patch every unread item on mark-all (rejected: unbounded transaction); keep no counter and count with a filter query (rejected: reads every item); a TTL-based expiry (rejected: it would desynchronise the counter; spec assumes no deletion).
- **Cost**: every publish and read-state change touches one hot record per user. That record is per user, so contention is only among one user's own events; a version conflict retries.

## R-4: Producer entry points and the registry

- **Decision**: registry in `core-table/helpers/notification-types.ts`; params are flat `Record<string, string>` validated by a required-names list per type; builders return `{ title, body, link: { portal, path } }`, truncating long text.
- **Rationale**: a flat string map is storable on the broadcast record and trivial to validate without zod in core-table (which has no zod dependency). Putting the registry in core-table means every API and handler reaches it through the package they already import (CLAUDE.md: any code needing the table already depends on core-table).
- **Types shipped**: `announcement.posted`, `discussion.reply`, `review.received`, `assignment.returned`. The first three target the student portal (`review.received` the instructor portal). Their params and paths are in [contracts/producer-helpers.md](./contracts/producer-helpers.md). Producers (#279, #280, #282, assignment returns) wire the calls in their own features.
- **Alternative**: a registry in `common-server-utils` (rejected: the stream handler and APIs would depend on it separately from the table helper that must validate types; one home is simpler).

## R-5: Email delivery state machine

- **Decision**: `email.state` on the notification: `pending` (set at creation) to `sending` (claim) to `sent`, plus terminal `skipped` (with `reason`), `failed` (with `reason`) and `unknown`.
- **Rationale**: SES has no idempotency key, so exactly-once is impossible; the choices are at-most-once or at-least-once. The acceptance criterion says idempotent on retry, and a duplicate email is worse than a missed one when the bell has the notification too. The claim is a conditional patch, so two concurrent invocations cannot both send. A claim older than 5 minutes (Lambda timeout is far below that) means the sender crashed after a possible send: mark `unknown`, never resend.
- **Transient errors** (throttling, 5xx): release the claim to `pending` by conditional patch and throw, so the queue redelivers. **Permanent** (bad address, message rejected, sandbox, unverified identity): record `failed` with a reason and finish. After five receives the message moves to the feature's failure queue (it holds the stream record itself, so a redrive resumes delivery), and the notification stays `pending` or `sending`-then-`unknown` until then.
- **Stuck `pending`**: a `pending` email older than 1 hour means delivery gave up (retries exhausted, in the failure queue) or never ran. `notification-shape` flags it, beside the existing stuck-`sending` and stuck-broadcast rules, with a breaking test (T007). Chosen over a DLQ alarm because the design already checks stuck states this way, needs no new infrastructure or alarm destination, and T038 already checks the failure queue is empty on the deployed stage. The router also puts an alarm on each feature's failure queue (no action), so this rule backs it up rather than replacing it.
- **Alternatives**: at-least-once with SES `MessageId` dedupe (rejected: SES cannot dedupe); a separate delivery table (rejected: one more entity and write for the same keyed record).

## R-6: Unsubscribe route and one-click

- **Decision**: a plain public route `/unsubscribe/{token}` on the core API: `GET` returns the type's name (no change), `POST` applies, and also accepts the RFC 8058 body `List-Unsubscribe=One-Click`. A small Lambda (`notification-unsubscribe`) serves both. The student portal's `/unsubscribe?token=` page uses `GET` then `POST`.
- **Found**: core-api's `PUBLIC_OPERATIONS` only covers tRPC procedures, and tRPC mutations expect a JSON body, which a mail client's one-click POST (form-encoded) does not send.
- **Rationale**: mailbox providers (Gmail, Yahoo) require one-click unsubscribe for bulk senders; a link that changes state on GET is unsafe because mail scanners follow links.
- **Alternatives**: a tRPC public mutation only (rejected: not one-click compatible); a Lambda Function URL (rejected: bypasses the API's WAF and throttles); handling in the portal only (rejected: no header target).
- **Risk**: the construct has no non-tRPC route yet (plan R6): spike first.

## R-7: Token signing

- **Decision**: `HMAC-SHA256` over `userId + "\n" + type`, key in a Secrets Manager secret (generated, in `Data`), no expiry, constant-time compare, scoped to one user and one type. Locally a fixed dev key in `local-dev`.
- **Rationale**: links in old emails must keep working, and the only power a token gives is switching off one type for one person, which is low risk and reversible. Rotating the secret invalidates all old links; acceptable.
- **Alternatives**: a stored random token per user (rejected: another record to write and read); JWT (rejected: no claims needed beyond what the HMAC covers).

## R-8: Where email and links come from

- **Decision**: `fromAddress` and `sesIdentity` are stage config (`notifications` block in `stages.types.ts`, settable via the existing `<STAGE>_INFRA_…` env overrides). The delivery Lambda gets the portals' public URLs and the core API URL as environment variables from the stacks (the same CloudFront and custom-domain values CORS already uses). No config means `email.state = skipped / not-configured`.
- **Rationale**: both are account-specific, like domains and certificates, so they are not committed. `CoreApiStack` already depends on the Websites stack for CORS, so the URLs add no new dependency direction.
- **IAM**: `ses:SendEmail` on the identity ARN only; `GetSecretValue` on the token secret for delivery and unsubscribe only. Not on the shared router.

## R-9: Local stand-in for SES

- **Decision**: `sendEmail` in `common-server-utils` posts to the event runner (`POST /emails`) when `LOCAL_DEV=true`; the runner writes JSON files under the git-ignored `tmp/local-dev/emails/` and serves `GET /emails` and a small HTML `GET /inbox`. `reset-local-data` deletes the folder. The runner already runs the delivery handler off the local stream, so the whole path works offline.
- **Rationale**: matches the S3Mock, Scheduler and MediaConvert stand-ins; files survive restarts like other local data; no new container.
- **Alternatives**: MailHog or Mailpit in Docker (rejected: another container for a capture-only need, and SES's header and body shape would not be exercised); log to console (rejected: not inspectable for the unsubscribe flow).

## R-10: Portal bell

- **Decision**: a presentational `NotificationBell` in `common-shadcn` (props: count, items, loading, callbacks), wired in each portal by a thin component calling core-api's `notification.*`. Count polls every 60 s and refetches on window focus; the list loads on open. An icon-only bell button is allowed by the repo's button rule; "Mark all as read" and "Load more" are text buttons.
- **Rationale**: the three portals each have their own tRPC client and layout, so only the UI can be shared. No websockets (spec: out of scope).
- **Settings**: a `/settings/notifications` route in each portal listing the registry's types with a switch; the registry list comes from `notification.preferences`.
