# Research: Instructor Announcements

Decisions that the spec could not make, with the code facts behind them. Each is referenced from [plan.md](./plan.md).

## R-1: One new entity, no index, newest first from the sort key

**Decision**: a new `announcement` entity in the core table. Primary key: pk `courseId`, sk `announcementId`. No new index. The id is a UUID version 7, whose first 48 bits are the creation time in milliseconds, so a course's announcements sort by time under one partition key and "newest first" is a descending keyed query with ElectroDB's cursor for paging.

**Rationale**: constitution V (records read together share a partition key, sort keys make children a contiguous range). The pk is the same raw `COURSE#<courseId>` partition `enrolment`, `courseInstructor` and the curriculum entities use; entity prefixes keep sort keys apart, as they do for `enrolment`, and like it the entity stays out of the `curriculum` collection because nothing reads announcements with the curriculum. Paging by cursor on the sort key satisfies FR-012 (stable under posts and deletes).

**Alternatives**: a GSI by `(courseId, createdAt)` (an index for no access pattern the primary key does not serve); `createdAt#id` as the sort key (an edit or delete would need the time as well as the id, and a client retry could not be idempotent).

## R-2: Who may write, and the course check, in one transaction

**Decision**: every write is one `transaction.write` that includes (a) a check that the caller's `courseInstructor` record exists and (b) for a create only, a check that the course's status is `published`, both with ElectroDB `check` items, beside the announcement write. The procedure also does the keyed reads first to give a precise error (`FORBIDDEN` for a non-instructor, `NOT_FOUND` for a missing course or announcement, `PRECONDITION_FAILED` for an unpublished course), the way `createContentItemText` does. A cancelled transaction is re-read and reported precisely.

**Rationale**: FR-007 and the acceptance scenario about a course archived a moment earlier require the check in the same write, not only before it. The instructor-removed-meanwhile edge case needs the membership check in the write as well. Both are keyed `check` items, which core-table's other helpers already use (for example `studentActivityWrites`' course and enrolment checks).

**Alternatives**: checking before the write only (a race window the spec rules out).

## R-3: Client-minted id, server-validated, makes posting idempotent

**Decision**: the portal mints a UUID v7 when the create form opens and sends it as `announcementId`. The server accepts it only if it is a well-formed v7 UUID whose time part is at most 1 minute ahead of and at most 10 minutes behind the server's clock, and sets `createdAt` to that time. `createdAt` is therefore a function of the id, which makes the notification request's `occurredAt` and dedupe key the same on every retry. The create is conditioned on the id not existing. A retry after a commit hits that condition: the procedure reads the record and, when its course, author, title and body equal the request's, returns it as success; otherwise it answers `CONFLICT`.

**Rationale**: the spec requires a retried post to be one announcement and one notification per student (FR-004, FR-006). A server-minted id cannot be repeated by a retry, and an idempotency-key index would be a new access pattern. Skew is bounded by the validation window, and ordering by a client clock within 10 minutes is acceptable for announcements. The `uuid` package is already a catalog dependency of instructor-api; the instructor portal gains it.

**Alternatives**: a server-minted id with a client request key stored on the record and found by a GSI (an index for a retry path); hashing the key into a deterministic non-time id and ordering by a separate `createdAt` sort key (needs the time to address the record on edit and delete).

## R-4: Publish through `notifyCourseStudents`, never anything else

**Decision**: `announcementWrites` (core-table, `helpers/announcement.ts`) builds the create transaction items by calling the notifications contract's `notifyCourseStudents(service, { type: 'announcement.posted', courseId, params: { courseId, courseTitle, announcementTitle, excerpt }, dedupeKey: announcementId, occurredAt: createdAt })` and adding its one `notificationBroadcast` create to the announcement's items. Nothing in this feature imports a notification entity, reads enrolments for delivery or knows about email.

**Rationale**: FR-003, FR-023 and the notifications contract ("nothing else may write the four notification entities"). The helper is core-table's because the rule (an announcement and its audience request exist together, with this key and time) spans two records and is covered by an invariant (constitution IV). The contract's test seam (`NOTIFICATION_TYPES` for assertions; the helper mocked in the procedure test as other helpers are in `course.test.ts`) is what the tests use.

**Contract notes** (see [contracts/announcement-producer.md](./contracts/announcement-producer.md)): the registry row for `announcement.posted` names `/learn/<courseId>`, the public course page; the enrolled student's course home is `/learn/<courseId>/home`. One entry changes, in notifications task T002 (its registry), with its test. Nothing else in the contract changes. `courseTitle` is read from the course record the procedure already read. The excerpt is at most 200 characters, within the 500-character body limit the contract applies.

## R-5: The excerpt is plain text from the stored document

**Decision**: a small `plainTextExcerpt(document, maxChars)` in `@discava/common-tiptap` (`src/text.ts`, one topic). It parses the stored JSON with the shared content schema, joins the block texts with single spaces, shows a formula as its LaTeX source, collapses whitespace, and cuts at the last word boundary within `maxChars` adding an ellipsis. instructor-api calls it and passes the string as a plain param.

**Rationale**: Tiptap content is the one rich-text format (lesson text, quiz questions); its schema lives in `common-tiptap`, which instructor-api, the portals and `common-shadcn` already use. core-table does not depend on it and should not, so the procedure computes the excerpt and the helper only receives a string. The notification pipeline escapes it where shown (notifications FR-019).

**Alternatives**: building the excerpt inside the registry (the registry is pure over string params and must not import editor code); HTML stripping (there is no stored HTML).

## R-6: Two read paths, two APIs

**Decision**: students read through a new core-api `announcement.list` (protected; the caller must have a non-dropped enrolment, via the same `requireEnrolment` rule `course.view` uses). Instructors read through a new instructor-api `announcement.list` (the caller must be on the course). Each has its own zod schema in its own `schema/announcement.ts`, as the other procedures do. Both resolve the author display name with one batch `user.get` over the page's distinct author ids (a page is at most 20), and both use core-table's `announcementPage` helper so the key logic is in one place.

**Rationale**: CLAUDE.md's split: core-api is for what any authenticated user may call, instructor-api for instructors. An instructor of an archived course must be able to read, which the enrolment rule would not give them.

**Alternatives**: one core-api procedure with an instructor branch (mixes two audiences' rules in one place); the course home using instructor-api (students are not instructors).

## R-7: Where it appears in each portal

**Decision**: the student portal's `CourseHome` gets an "Announcements" card above the outline (the first thing a student who followed a notification sees), using an infinite query on `announcement.list`, "Load more" under it, and the shared `RichTextView` for each body. The instructor portal's course page gets an "Announcements" section after the course content on the same page: a child route under the page's directory would turn its `route.tsx` into a layout needing an outlet, a routing change this feature does not need. It holds the list, the create form (not shown for an archived course), and edit and delete using the existing `RichTextEditor` and the portal's existing confirm-dialog pattern.

**Rationale**: the issue asks for "the course home". Both bodies render through the shared view, which only renders nodes of the shared schema (FR-020).

## R-8: What the invariants check, and the scan

**Decision**: two new checks in `helpers/invariants.ts`, both scans in tooling only: `announcement-shape` and `announcement-has-broadcast` (details in [data-model.md](./data-model.md)). The second matches the broadcast by its own attributes (type, course, dedupe key, occurred-at), so it needs no hash function from the notifications code and no contract change. It is one-directional: deleting an announcement leaves its broadcast.

**Rationale**: constitution IV. The snapshot already scans the core table for the other checks, and notifications task T007 adds the broadcasts to it.

## R-9: Local development

**Decision**: nothing new. The announcement is DynamoDB (local) like everything else; delivery runs on the notifications spec's local event runner (fan-out, bell). Without notifications Phase 5, announcements still post and show; the broadcast waits unprocessed (edge case in the spec).

## R-10: Stream consumers

**Decision**: announcement writes produce INSERT, MODIFY and REMOVE stream records. `PROGRESS_STREAM_FILTERS` and `SEARCH_STREAM_FILTERS` match by entity name and so ignore them, and the notification filter (INSERT of `notification` and `notificationBroadcast` only) ignores them too. A unit test asserts all three filters reject an announcement record, so a later filter edit cannot make announcements trigger progress, search or delivery.
