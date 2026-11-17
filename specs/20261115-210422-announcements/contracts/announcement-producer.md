# Contract: How announcements use the notifications producer contract

This feature is a consumer of [notifications' producer contract](../../20261115-204427-notifications/contracts/producer-helpers.md). It uses exactly two things from it and adds nothing to it except one registry path.

## What is used

| From `@discava/core-table` (notifications) | Use here |
|--------------------------------------------|----------|
| `NOTIFICATION_TYPES['announcement.posted']` | Registered type, params `courseId`, `courseTitle`, `announcementTitle`, `excerpt`, student portal, email policy `default-on` |
| `notifyCourseStudents(service, input)` | Called once, inside `announcementWrites`, on create only |

Not used, and not to be used: `notificationWrites`, `publishNotification`, any notification entity, the read helpers, the email transitions.

## The call

```ts
notifyCourseStudents(service, {
  type: 'announcement.posted',
  courseId,
  params: { courseId, courseTitle, announcementTitle: title, excerpt },
  dedupeKey: announcementId,
  occurredAt: createdAt, // the id's time part, ISO
});
```

- The returned create item joins the announcement create, the instructor check and the course-published check in one `service.transaction.write` (4 items).
- A retry of the same post reproduces the same type, course, key and time, so it cancels on the first not-exists condition (the announcement's own), and the procedure answers from the stored record.
- `excerpt` is plain text, at most 200 characters, from `plainTextExcerpt` (research R-5). `courseTitle` is the course's title at post time.
- Edit and delete never call it.

## Required change to the notifications contract

| Where | Change | Why |
|-------|--------|-----|
| Notifications registry, `announcement.posted` `build` and its row in the contract's table | `link.path` is `/learn/<courseId>/home` instead of `/learn/<courseId>` | The student portal's `/learn/$courseId/` is the public course page; an enrolled student's course home, where announcements are shown, is `/learn/$courseId/home` |

This is the notifications spec's task T002 (registry and its test). If that task has merged, this feature's first foundation task makes the same change with its test, as the contract says a change is deliberate and tested. No signature, param or policy changes.

## What this feature relies on being true

- `notifyCourseStudents` validates the type, the params and the key before any I/O and returns exactly one create item.
- The pipeline notifies students with a non-dropped enrolment when it processes the broadcast, each with the broadcast's dedupe key, and never notifies instructors.
- The notifications spec's invariants and stream-filter tests are in place (`notificationBroadcast` is in the invariant snapshot), which this feature's `announcement-has-broadcast` check reads.

Which notifications tasks must land first is listed in the spec's "Dependency on the notifications spec" and in this feature's tasks (Phase 1).
