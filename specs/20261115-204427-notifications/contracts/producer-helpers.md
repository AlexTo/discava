# Contract: Producer helpers (`@discava/core-table`)

The public face of the feature. Everything a producer needs is exported from `@discava/core-table`; nothing else may write the four notification entities (constitution IV: the rule lives in one helper). Changing anything here is a breaking change to #279, #280, #282 and assignment returns, so it is made deliberately, with its tests.

## Registry

```ts
type NotificationPortal = 'student' | 'instructor' | 'admin';
type EmailPolicy = 'default-on' | 'default-off' | 'required' | 'never';

interface NotificationType<P extends string = string> {
  id: string;                    // stable, '<area>.<event>'
  name: string;                  // settings label
  description: string;           // settings text
  params: readonly P[];          // required flat string params
  emailPolicy: EmailPolicy;
  build(params: Record<P, string>): {
    title: string;
    body: string;
    link: { portal: NotificationPortal; path: string };
  };
}

export const NOTIFICATION_TYPES: Record<string, NotificationType>;
```

Rules: `build` is pure and total over valid params; the helpers truncate title to 120 and body to 500 characters; `link.path` starts with `/` and contains no secret. Adding a type is one entry plus a test in `notification-types.test.ts`; nothing else changes.

### Types shipped in v1

| id | Params | Portal and path | Email policy |
|----|--------|-----------------|--------------|
| `assignment.returned` | `courseId`, `lessonId`, `assignmentTitle`, `courseTitle` | student, `/learn/<courseId>/lesson/<lessonId>` | default-on |
| `announcement.posted` | `courseId`, `courseTitle`, `announcementTitle`, `excerpt` | student, `/learn/<courseId>/home` | default-on |
| `discussion.reply` | `courseId`, `lessonId`, `authorName`, `excerpt` | student, `/learn/<courseId>/lesson/<lessonId>` | default-on |
| `review.received` | `courseId`, `courseTitle`, `rating` | instructor, `/my-courses/<courseId>/reviews` | default-off |

Titles, bodies and exact paths are written in the task that adds the registry and reviewed there; the paths above follow the student portal's current routes (`learn/$courseId/lesson/$lessonId`). The instructor path for `review.received` follows the reviews spec (PR #358), and is confirmed against the instructor portal's routes when #279 lands.

## `notificationWrites`

```ts
notificationWrites(
  service: CoreTable,
  input: {
    type: string;
    userId: string;
    params: Record<string, string>;
    dedupeKey: string;      // required: names the event, e.g. `${contentItemId}:${version}`
    occurredAt: string;     // ISO, from the producer's own record
  },
): Promise<TransactionItems>;
```

- Validates before any I/O: type registered, every param present and a string, `dedupeKey` non-empty, `occurredAt` a valid ISO instant. Throws `NotificationInputError` (exported) otherwise.
- Does one keyed read (the user's `notificationState`) and returns the transaction items: the `notification` create, and the state create or update. The caller adds them to its own `service.transaction.write` (the producer's write plus these items, at most 100 items in all).
- A cancelled transaction is handled by the caller as for any condition failure: re-read and retry. A duplicate publish (same type, user, dedupe key) cancels the transaction on the notification create, which for a producer's own retry after a commit is the correct outcome.
- Does not check that the user exists or has an email.

## `publishNotification`

Same input. Runs `notificationWrites` in its own transaction and returns `'created' | 'duplicate'`. It retries a state-version conflict up to 3 times, and treats a cancellation caused by the notification create as `duplicate` (logging a warning when the stored title differs from what the new params would build). Use when the notification is not part of another write, or for fan-out.

## `notifyCourseStudents`

```ts
notifyCourseStudents(service, {
  type: string; courseId: string; params: Record<string, string>;
  dedupeKey: string; occurredAt: string;
}): TransactionItems; // one `notificationBroadcast` create
```

Validation as above. Returns one create item (not exists) for the producer's transaction or `service.transaction.write` on its own; a repeat with the same key cancels on it. The pipeline then notifies each student enrolled (status not `dropped`) when the stream handler processes it, with each student's notification using `dedupeKey`, so a retry is safe. Audience: students only; to notify instructors use `notificationWrites` for each.

## Consumers' helpers (not for producers)

`markNotificationRead(service, userId, position)` and `markNotificationsRead(service, userId, through)` (core-api's `markRead` and `markAllRead` call them); `notificationEmailTransitions` (delivery only). These are exported but documented as internal: producers MUST NOT call them.

## Test seams for producers

`@discava/core-table` exports `NOTIFICATION_TYPES` so a producer's unit test can assert its call's input is valid against the registry (`notificationWrites` is mocked as other helpers are in `course.test.ts`).
