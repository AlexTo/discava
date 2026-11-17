# Data Model: Announcements

One new entity in the core table, no new index. It reads `course`, `courseInstructor`, `enrolment` and `user`, and writes one `notificationBroadcast` through the notifications contract.

## announcement

One per post. Primary key: pk `courseId`, sk `announcementId`. Not part of the `curriculum` collection (as `enrolment` is not).

| Attribute | Notes |
|-----------|-------|
| `courseId` | Owning course |
| `announcementId` | UUID v7, minted by the client, validated by the server (research R-3). Sorts by creation time |
| `title` | 1 to 120 characters after trimming |
| `body` | Tiptap document as a JSON string, valid against `@discava/common-tiptap`'s content schema, at least one character of text, at most 20,000 characters |
| `authorId` | The instructor who created it (Cognito `sub`); never changes |
| `createdAt` | ISO instant equal to the id's time part; never changes |
| `editedAt` | Set by every edit; absent until the first |
| `version` | Starts at 1, +1 on every edit; an edit is conditioned on the version the caller read |
| `updatedAt` | ElectroDB's usual watched timestamp |

No status or soft-delete attribute: a delete removes the record.

## Access patterns

| Request | Access |
|---------|--------|
| List a course's announcements, newest first, paged | Query pk `courseId`, descending, limit 20, ElectroDB cursor |
| Read one for edit or delete | Keyed get on `(courseId, announcementId)` |
| Instructor check | Keyed get of `courseInstructor(courseId, instructorId)` |
| Student check | Keyed get of `enrolment(courseId, userId)` and `course(courseId)` |
| Author names | One batch get of `user` for the page's distinct `authorId`s |
| Invariants | Table scan, tooling only (existing snapshot) |

## Writes by case

| Case | Items in one transaction |
|------|--------------------------|
| Create | `announcement` create (not exists); `courseInstructor` check (exists); `course` check (status `published`); `notificationBroadcast` create from `notifyCourseStudents` (`announcement.posted`, dedupe key = `announcementId`, occurred-at = `createdAt`) |
| Edit | `announcement` patch of `title` and/or `body`, `editedAt`, `version + 1`, condition `version = <read>`; `courseInstructor` check |
| Delete | `announcement` delete (condition: exists); `courseInstructor` check |
| Retry of a create | Cancelled on the not-exists condition; the procedure reads the record and returns it when it equals the request (otherwise `CONFLICT`) |

An edit and a delete write no notification items.

## Impact check

Shared records this feature writes or reads in a new way, per constitution IV:

| Record | Use | Existing invariants and tests covering it | Change |
|--------|-----|-------------------------------------------|--------|
| `course` | Read; status checked in the create transaction | Existing course shape and lifecycle checks and `course.test.ts` | None |
| `courseInstructor` | Read; checked in each write | Existing membership checks | None |
| `enrolment` | Read for access only (core-api list). Delivery reads it inside the notification pipeline, not here | Existing enrolment checks | None |
| `user` | Read, batch, for author names | Existing user-record checks | None |
| `notificationBroadcast` | Created only through `notifyCourseStudents`, inside `announcementWrites` | The notifications spec's `notification-broadcast-done-complete` and its helper tests | None to its checks; one new check here ties announcements to broadcasts |
| `announcement` | New; written only by `announcementWrites`, `announcementEditWrites` and `announcementDeleteWrites` | New (below) | New checks |
| Stream consumers (progress, search, notification) | Announcement writes add stream records | `PROGRESS_STREAM_FILTERS`, `SEARCH_STREAM_FILTERS`, `NOTIFICATION_STREAM_FILTERS` match by entity name | None to the filters; a test asserts none match `announcement` |

No counted record, completion, enrolment or content item changes meaning, so no existing invariant is extended. New invariants in `helpers/invariants.ts`, each with a test that breaks it:

1. `announcement-shape`: the course exists; `announcementId` is a v7 UUID whose time equals `createdAt`; title 1 to 120 characters; `body` parses as JSON with top-level `type` `doc` and is at most 20,000 characters (full schema validation is the API's job on write; core-table imports no editor code); `authorId` set; `version >= 1`; `editedAt` is present exactly when `version > 1` and is not before `createdAt`.
2. `announcement-has-broadcast`: for each announcement a `notificationBroadcast` exists with type `announcement.posted`, the same `courseId`, `dedupeKey` equal to the announcement id, and `occurredAt` equal to its `createdAt`. One direction only: a deleted announcement leaves its broadcast.

## Helpers (`packages/databases/core-table/src/helpers/announcement.ts`)

Exported from `src/index.ts`, called by every writer; nothing else writes the entity.

- `announcementIdTime(id, now)`: parses a v7 UUID, returns its instant, throws `AnnouncementInputError` unless the time is within the accepted window (R-3).
- `announcementWrites(service, input)`: validates (title, body size, id), builds the create items above, including `notifyCourseStudents`.
- `announcementEditWrites(service, input)` and `announcementDeleteWrites(service, input)`.
- `announcementPage(service, { courseId, cursor, limit })`: the descending keyed query, returning items and the next cursor.
