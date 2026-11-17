# Contract: core-api `announcement` router

One procedure on `packages/apis/core-api`, `protectedProcedure` (any signed-in user), registered in `router.ts` as `announcement: router({ list })`. It is not a public operation: the router test's `PUBLIC_OPERATIONS` is unchanged and the new operation is asserted to require authentication.

## `announcement.list` (query)

Input: `{ courseId: string, cursor?: string, limit?: number (1..20, default 20) }`. The caller is `ctx.user.sub`; no user id is accepted.

1. Read the course and the caller's enrolment; `NOT_FOUND` when the course does not exist.
2. `requireEnrolment(course, enrolment)` (the rule `course.view` uses): no enrolment or `dropped` is `FORBIDDEN` for a published course ("Enrol in the course to view it") and `NOT_FOUND` otherwise. Archived courses stay readable by their enrolled students, as their other content is.
3. `announcementPage` (core-table) descending by id, then one batch `user.get` for the page's distinct authors.

Output (schema in `src/schema/announcement.ts`):

```ts
{
  items: {
    announcementId: string;
    courseId: string;
    title: string;
    body: string;          // Tiptap JSON string
    authorName: string;    // "Given Family", falling back to "Instructor"
    createdAt: string;
    editedAt?: string;
  }[];
  cursor?: string;         // pass back to load the next page
}
```

`authorId` and `version` are not exposed to students. Output validation is strict, so a stored record failing the schema is a server error caught by the invariant `announcement-shape`, not shown.

## Tests

`src/procedures/announcement.test.ts` per `assignment.test.ts`: enrolled student gets newest-first items; not enrolled, dropped (published course) and unknown course are refused with the codes above; another course's announcements are never returned; paging returns every item once across pages and is stable when an item is added between pages; the output omits `authorId` and `version`; an archived course still lists for an enrolled student. `router.test.ts` asserts the operation is protected.
