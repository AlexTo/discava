# Data Model: Notifications

Four new entities in the core table, no new index. Keys use only each entity's primary index.

## notification

One per user per event. Primary key: pk `userId`, sk `occurredAt` + `id`. The sort key `<occurredAt>#<id>` is the notification's **position**, used as its public id.

| Attribute | Notes |
|-----------|-------|
| `userId` | Recipient (Cognito `sub`) |
| `occurredAt` | ISO time of the event, supplied by the producer (UTC, millisecond precision, fixed width so strings sort by time) |
| `id` | First 16 hex chars of `sha256(type + "\0" + dedupeKey)` |
| `type` | A registry id, for example `assignment.returned` |
| `title`, `body` | Built by the registry from the params at creation, truncated (title 120, body 500 characters) |
| `link` | `{ portal: 'student' \| 'instructor' \| 'admin', path }`, `path` starting with `/` |
| `readAt` | Set when marked read individually; absent otherwise. A notification is **read** when `readAt` is set or its position is at or before the user's `readThrough` |
| `email` | `{ state, reason?, claimedAt?, sentAt?, messageId? }`; `state` is always `pending` at creation; the delivery step records every other state, including `skipped / never` for a type whose policy is `never` |
| `createdAt` | When the record was written |

Email state machine (set only by `helpers/notification-email.ts`):

```text
pending --claim--> sending --ok--> sent
   |                  |--permanent error--> failed(reason)
   |                  |--transient error--> pending (claim released)
   |                  |--claim older than 5 min--> unknown
   |--skip--> skipped(reason: not-configured | opted-out | no-address | never)
```

`sent`, `skipped`, `failed` and `unknown` are final.

## notificationState

One per user, created by the first publish (the helper creates it when absent, in the same transaction as the first notification). Primary key: pk `userId`, sk `userId`.

| Attribute | Notes |
|-----------|-------|
| `userId` | |
| `unreadCount` | Number of the user's unread notifications; never negative |
| `readThrough` | Position at or before which every notification is read; absent until the first mark-all. Only moves forward |
| `version` | Starts at 1, +1 on every write; every write to the state is conditioned on the value read |

## notificationPreference

One per user and type, only where the user changed from the default. Primary key: pk `userId`, sk `type`.

| Attribute | Notes |
|-----------|-------|
| `userId`, `type` | `type` must be registered; a `required` type cannot be written |
| `emailEnabled` | boolean |
| `updatedAt` | |

Absent means the registry default for the type (`default-on` is on, `default-off` is off, `required` is on and not changeable, `never` is off and not shown).

## notificationBroadcast

An audience request. Primary key: pk `id`, sk `id`, where `id` = first 16 hex chars of `sha256(type + "\0" + courseId + "\0" + dedupeKey)`, so publishing twice is one request (create, not exists).

| Attribute | Notes |
|-----------|-------|
| `id`, `type`, `courseId` | |
| `params` | Flat string map, validated against the type at write |
| `occurredAt` | From the producer; every student's notification uses it |
| `dedupeKey` | The producer's key, used per student: each student's notification key is derived from `type` and `<dedupeKey>` (the same notification a single-user publish would make) |
| `cursor` | The last enrolment page's `LastEvaluatedKey` (JSON string), absent before the first page |
| `status` | `pending` or `done`; set to `done` when the last page is published |
| `createdAt`, `completedAt?` | |

State: `pending` to `done`. Fan-out resumes from `cursor` after a failure. A `done` broadcast is never reprocessed.

## Registry (code, not data)

`helpers/notification-types.ts` exports `NOTIFICATION_TYPES`, one entry per type: `id`, `name` and `description` (settings), `params` (required flat string names), `emailPolicy` (`default-on`, `default-off`, `required`, `never`), `build(params)` returning `{ title, body, link }`. See [contracts/producer-helpers.md](./contracts/producer-helpers.md).

## Writes by case

| Case | Records, one transaction each |
|------|-------------------------------|
| Publish, user's first | `notification` create (not exists), `notificationState` create (not exists) with `unreadCount` 1, `version` 1 |
| Publish | `notification` create (not exists), `notificationState` update `unreadCount + 1`, `version + 1`, condition `version = <read>` |
| Publish at or before `readThrough` | the same, but `notification` is created with `readAt` set (the position's time), and `unreadCount` is unchanged |
| Mark one read | `notification` patch `readAt` (condition: no `readAt`, position after `readThrough`), `notificationState` update `unreadCount - 1`, `version + 1` (condition `version = <read>`); an already read notification is a no-op success with no write |
| Mark all read up to a position | `notificationState` update `readThrough = position`, `unreadCount - n`, `version + 1`, conditions `version = <read>` and `readThrough = <read>`, with `n` counted from the keyed range query. Chunked at 500 items per call |
| Set a preference | `notificationPreference` put (create or replace) |
| Email transitions | `notification` patch `email` with a condition on the previous state |
| Audience fan-out | per student, as Publish; then `notificationBroadcast` patch of `cursor`, finally `status` |

## Impact check

Shared records this feature writes or reads in a new way, per constitution IV:

| Record | Use | Existing invariants and tests covering it | Change |
|--------|-----|-------------------------------------------|--------|
| `enrolment` | Read only: range by `courseId`, status not `dropped` | The existing enrolment shape and activity-count checks; nothing here writes it | None |
| `user` | Read only: keyed get for the address | The existing user-record checks (pre-token-generation tests) | None |
| `notification`, `notificationState`, `notificationPreference`, `notificationBroadcast` | Written only by core-table's notification helpers and read by core-api and the delivery handler | New (below) | New checks |
| Stream consumers (progress, search) | The new entities write many INSERT/MODIFY stream records | `PROGRESS_STREAM_FILTERS` and `SEARCH_STREAM_FILTERS` match by entity name; a test in `notification-stream.test.ts` asserts none of the four entities match them, and that the notification filter matches only INSERT of `notification` and `notificationBroadcast` | None to the filters |

No counted or related record changes meaning, so no existing invariant is extended. New invariants in `helpers/invariants.ts`, each with a breaking test:

1. `notification-unread-count-matches`: for each user, `unreadCount` equals the number of their notifications with no `readAt` and a position after `readThrough` (the invariant scans, in tooling only).
2. `notification-shape`: `type` is registered; the sort key equals `<occurredAt>#<id>` (the hash itself can't be rechecked without the dedupe key), `link.path` starts with `/`, `email.state` is `sent` only with `sentAt` and `messageId`, `skipped` and `failed` carry a `reason`, no `sending` older than 1 hour exists, and no `pending` email older than 1 hour exists (a notification whose delivery retries ran out and went to the DLQ).
3. `notification-state-exists`: a user with notifications has a state record, `unreadCount >= 0`, and `readThrough` (if any) is a valid position.
4. `notification-preference-shape`: `type` registered and not `required`.
5. `notification-broadcast-done-complete`: a `done` broadcast has `completedAt`; a `pending` one older than 1 hour is a violation (a stuck fan-out).
