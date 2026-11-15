# Contract: stream handler, email and local inbox

## Stream trigger

`NOTIFICATION_STREAM_FILTERS` (in `core-table/src/helpers/notification-stream.ts`, with `matchesNotificationStreamFilters`, built the same way as `SEARCH_STREAM_FILTERS`):

| eventName | image | entities |
|-----------|-------|----------|
| INSERT | NewImage | `notification`, `notificationBroadcast` |

Used by `CoreApiStack`'s `DynamoEventSource` (batch 100, 5 s window, 5 retries, bisect on error, own DLQ `NotificationDeliveryFailures`, SQS-managed encryption as the other two) and by the event runner locally.

## `notification-delivery` handler (`events/src/notifications/delivery.ts`)

Receives a batch of stream records and handles each by entity. A record that throws is reported as a batch item failure (`ReportBatchItemFailures`), so one record does not retry the others.

### `notificationBroadcast` INSERT: fan out

1. Get the broadcast; if `done`, return.
2. Query `enrolment` for the course (pk `courseId`), pages of 100, resuming from `cursor`; skip `dropped`.
3. For each student call `publishNotification` (concurrency 10) with the broadcast's type, params, `dedupeKey` and `occurredAt`; `duplicate` is fine.
4. After each page patch `cursor`; after the last, set `status: 'done'` and `completedAt`.
5. If the Lambda runs out of time or fails, the stream retries the record and step 2 resumes from the cursor.

### `notification` INSERT: send the email

1. Read the registry entry. Policy `never`: record `skipped / never`, stop.
2. If the stage has no sender (`NOTIFICATIONS_FROM_ADDRESS` unset): `skipped / not-configured`.
3. Read the user (`email`); none: `skipped / no-address`. Read the preference (keyed get); `emailEnabled` false, or the policy is `default-off` with no stored preference, and the policy is not `required`: `skipped / opted-out`.
4. Claim: patch `email.state` `pending` to `sending` with `claimedAt`, condition `state = pending`. Cancelled: re-read. `sent`, `skipped`, `failed` or `unknown` return. `sending` with `claimedAt` less than 5 minutes ago: throw, so the stream retries later. Older: patch to `unknown` (condition `sending`), return.
5. Send through `sendEmail` (below). Success: patch `sent` with `sentAt` and `messageId`. Permanent failure (`MessageRejected`, `BadRequest`, `AccountSuspended`, sandbox or unverified-identity errors): patch `failed` with a reason. Transient failure (throttling, 5xx, network): release the claim back to `pending` (condition `sending`) and throw.
6. Every transition is a conditional patch on the previous state in `helpers/notification-email.ts`, so a late or duplicate invocation cannot move a final state.

The Lambda's role has table read/write, `ses:SendEmail` on the configured identity and `GetSecretValue` on the token secret, and nothing else.

## `sendEmail` (`common-server-utils/src/email.ts`)

```ts
sendEmail(message: {
  to: string; from: string; subject: string;
  text: string; html: string;
  headers: Record<string, string>;   // List-Unsubscribe, List-Unsubscribe-Post
}): Promise<{ messageId: string }>;  // throws EmailPermanentError | EmailTransientError
```

Deployed: SES v2 `SendEmail` with `Content.Simple` (`Subject`, `Body.Text`, `Body.Html`, `Headers`). Local (`LOCAL_DEV=true`): `POST http://localhost:2024/emails`; the runner stores it and returns a generated id. Both map provider errors to the two error classes. Tests cover the mapping and the local switch.

## Email content (`events/src/notifications/email-template.ts`)

- Subject: the notification's title. Text and HTML bodies: title, body, a button and plain link to `<portal URL><link.path>`, a line "You get this because you have <name> emails on. Stop these emails: <unsubscribe URL>", and a link to settings.
- All user-supplied text is HTML-escaped in the HTML part; the text part is verbatim. Newlines in the title are removed (header injection).
- Headers: `List-Unsubscribe: <https://…/unsubscribe/<token>>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- Portal URLs and the API URL come from environment variables the stacks set (R-8); locally from `local-dev` (student 4201, instructor 4200, admin 4202, core-api 2022).

## Unsubscribe token

`<base64url(userId)>.<type>.<base64url(HMAC-SHA256(secret, userId + "\n" + type))>`. Verification recomputes and compares in constant time, and the type must be registered and not `required` or `never`. No expiry. `common-server-utils/src/unsubscribe-token.ts` exports `signUnsubscribeToken` and `verifyUnsubscribeToken`; the secret is read from Secrets Manager (cached per Lambda container) or the dev constant locally. Tests: round trip, tampered user, tampered type, truncated, wrong secret, a required type.

## Local event runner additions

- Applies `matchesNotificationStreamFilters` to the local stream and calls the same `delivery` handler, batched like the other consumers.
- `POST /emails`: store `{ id, receivedAt, to, from, subject, text, html, headers }` as JSON under `tmp/local-dev/emails/`.
- `GET /emails`: the stored messages, newest first, as JSON. `GET /inbox`: a plain HTML list, and `GET /inbox/<id>` a message with text, an HTML preview (in an iframe `srcdoc`) and its headers.
- `reset-local-data` deletes `tmp/local-dev/emails/`.
- `LOCAL_NOTIFICATIONS_FROM` defaults to `notifications@discava.local` so email is "configured" locally.

## Stage config

`infra-config` gains `notifications?: { fromAddress?: string; sesIdentity?: string }` on the stage's `infra` options (env overrides `<STAGE>_INFRA_NOTIFICATIONS_FROM_ADDRESS`, `…_SES_IDENTITY`). Unset: the Lambda gets no sender, grants no SES, and delivery records `not-configured`. `sesIdentity` is a verified domain or address; the grant is on `arn:aws:ses:<region>:<account>:identity/<sesIdentity>`.
