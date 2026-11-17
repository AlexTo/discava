# Contract: instructor-api `announcement` router

Four procedures on `packages/apis/instructor-api`, all `protectedProcedure` (so the caller is in the `instructor` group), built on `courseProcedure` for `ctx.coreTable`. Every one first checks the caller's `courseInstructor` record for the named course and throws `FORBIDDEN` without it. None takes a user id. Schemas live in `src/schema/announcement.ts`; the procedures in `src/procedures/announcement.ts`.

## Shapes

```ts
Announcement = {
  announcementId: string;   // UUID v7
  courseId: string;
  title: string;            // 1..120 after trim
  body: string;             // Tiptap JSON string, valid, with text, <= 20000 chars
  authorId: string;
  authorName: string;       // "Given Family", falling back to "Instructor"
  createdAt: string;        // ISO
  editedAt?: string;
  version: number;
}
```

## `announcement.create` (mutation)

Input: `{ courseId, announcementId, title, body }`.

1. Validate title, body (`isValidTiptapDocument`, has text, size) and `announcementId` (v7, time within 1 minute ahead and 10 minutes behind). `BAD_REQUEST` naming the field.
2. Membership check (`FORBIDDEN`); read the course (`NOT_FOUND` if missing); `status !== 'published'` is `PRECONDITION_FAILED` ("Only a published course can have announcements").
3. Build the excerpt with `plainTextExcerpt(body, 200)`; call `announcementWrites` and `service.transaction.write`.
4. On a cancelled transaction, re-read: an existing announcement equal to the request (same course, author, title, body) is returned as success (a retry); a different one with that id is `CONFLICT`; otherwise report the failed rule (membership removed: `FORBIDDEN`; course no longer published: `PRECONDITION_FAILED`).

Output: the `Announcement`. Notifies students (through the producer contract) exactly once per id.

## `announcement.list` (query)

Input: `{ courseId, cursor?: string, limit?: number (1..20, default 20) }`. Membership check only; any course status, so archived courses list. Output: `{ items: Announcement[], cursor?: string }` newest first, authors resolved by one batch get.

## `announcement.update` (mutation)

Input: `{ courseId, announcementId, version, title?, body? }`, at least one of title and body. Reads the record by `(courseId, announcementId)` (`NOT_FOUND`, which is also the answer when the id belongs to another course), validates what changed, then `announcementEditWrites` with the condition `version = <input.version>`. A version that is not current is `CONFLICT` ("This announcement changed. Reload to see the latest text.") and the output of the next `list` shows the newer text. Allowed at any course status. Never touches notifications. Output: the updated `Announcement`.

## `announcement.delete` (mutation)

Input: `{ courseId, announcementId }`. `NOT_FOUND` when missing or in another course; otherwise `announcementDeleteWrites`. Allowed at any course status. Output: `{ announcementId }`. Does not touch notifications.

## Errors, summarized

| Case | Code |
|------|------|
| Not on the course | `FORBIDDEN` |
| Course or announcement missing, or announcement of another course | `NOT_FOUND` |
| Invalid title, body or id | `BAD_REQUEST` |
| Create on a course that is not published | `PRECONDITION_FAILED` |
| Stale version, or a retry id with different content | `CONFLICT` |

## Tests

`src/procedures/announcement.test.ts` per `course.test.ts` (`t.createCallerFactory`, `vi.mock` of the helpers' transaction): authorization for each procedure (student-group caller, instructor not on the course, admin not on the course), validation, retry returns the same record, archived and draft course rules, version conflict, cross-course id, and that `create` passes `announcement.posted` params the registry accepts (`NOTIFICATION_TYPES['announcement.posted'].params`) while `update` and `delete` call no notification helper.
