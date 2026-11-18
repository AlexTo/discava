# Contract: notification hooks (Phase 7, depends on the notifications spec)

Uses the notifications spec's [producer helpers](../../20261115-204427-notifications/contracts/producer-helpers.md) unchanged. It writes no notification record, sends no email and checks no preference.

## Registry entries

| id | Params | Portal and path | Email policy |
|----|--------|-----------------|--------------|
| `discussion.reply` (already in the notifications v1 table) | `courseId`, `lessonId`, `authorName`, `excerpt` | student, `/learn/<courseId>/lesson/<lessonId>` | default-on |
| `discussion.answered` (added by this feature) | `courseId`, `lessonId`, `authorName`, `excerpt` | student, `/learn/<courseId>/lesson/<lessonId>` | default-on |
| `discussion.accepted` (added by this feature) | `courseId`, `lessonId`, `excerpt` | student, `/learn/<courseId>/lesson/<lessonId>` | default-off |

`authorName` is the replier's name for `discussion.reply` and the acceptor's name for `discussion.answered`; `excerpt` is the first 140 characters of the reply, plain text with an ellipsis. Titles and bodies are written in the task that adds the entries (for example "Alex replied to your question") and reviewed there. Adding the two entries is one change to `helpers/notification-types.ts` and a test in `notification-types.test.ts`.

## `discussionNotificationWrites(service, event)` (`helpers/discussion-notifications.ts`)

```ts
event:
  | { kind: 'reply'; reply: Post; question: Post }
  | { kind: 'accepted'; question: Post; reply: Post; acceptedBy: string; at: string }
Promise<TransactionItems>
```

Returns the items the procedure adds to its `discussionWrites` transaction, from the notifications spec's `notificationWrites`:

| Event | Notifications |
|-------|----------------|
| `reply` | `discussion.reply` to the question's author, unless the replier is that author. `dedupeKey` = the reply's `postId`; `occurredAt` = the reply's `createdAt` |
| `accepted` | `discussion.accepted` to the reply's author unless `acceptedBy` is that author; `discussion.answered` to the question's author unless `acceptedBy` is that author. `dedupeKey` = `<threadId>:<postId>`; `occurredAt` = `at` |

Rules: nothing for a reply or question that is not `shown`; a duplicate (retry, or accepting the same reply again) cancels on the notification create and the caller treats it as already done; at most two notifications per event, so a transaction stays at most 11 items. The helper does not check that the recipient still has access: the lesson link is refused for someone who has dropped, as any course link is.

## Producer call sites

`discussion.reply` adds the `reply` event's items; `discussion.accept` adds the `accepted` event's items only when it sets a new accepted answer (not when it removes one or repeats the same one). Instructor-api's `accept` is not used; instructors accept through core-api's `discussion.accept`.

## Tests

`discussion-notifications.test.ts` (mock `notificationWrites` as the notifications spec's tests do): who is and is not notified for each event, dedupe keys, `occurredAt`, every call's input is valid against `NOTIFICATION_TYPES`, nothing for hidden or deleted posts. Procedure tests assert the notification items are in the same transaction and absent when the replier is the asker. The phase's e2e check needs the notifications spec's fan-out path in the local event runner.
