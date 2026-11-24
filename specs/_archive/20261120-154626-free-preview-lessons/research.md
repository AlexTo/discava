# Research: Free Preview Lessons

This feature opens a deliberate exception to "unpaid users cannot get paid content" (Stripe checkout spec, User Story 2). Each decision below says what is opened, what stays closed, and what was rejected.

Code read for this research: `packages/apis/core-api/src/procedures/enrolment.ts` (`requireEnrolment`), `content-item.ts`, `course.ts` (`publicView`, `previewVideoUrl`, `view`), `quiz.ts`, `router.ts` (`PUBLIC_OPERATIONS`), `helpers/playback.ts`, `helpers/discussion-access.ts`, `procedures/paid-access.test.ts`, `page-renderer/render-course.ts`; `packages/common/server-utils/src/lesson-media.ts` and `media-keys.ts`; `packages/common/constructs/src/app/apis/core-api.ts` (`CORE_API_DEDICATED_FUNCTIONS`) and `core/media-bucket.ts`; `packages/databases/core-table/src/entities/lesson.ts`, `content-item.ts`, `helpers/curriculum.ts`, `helpers/invariants/payments.ts` and `curriculum.ts`, `helpers/stream-features.ts`; `packages/apis/instructor-api/src/procedures/lesson.ts`; the student portal's `routes/learn/$courseId/` and the instructor portal's `-components/course/course-modules.tsx`.

## R-1: Where the mark lives, and why assignment lessons cannot carry it

**Decision**: An optional attribute `freePreview` on the `lesson` entity, stored only as `true` and removed when the lesson is unmarked. instructor-api's `lesson.setFreePreview` writes it in the transaction lesson edits already use (`writeUnderActiveAncestors`), with two conditions on the lesson: `archivedAt` does not exist and `kind = 'lesson'`. A request to mark an assignment lesson is refused with `BAD_REQUEST` before the write and by the condition during it.

**Rationale**:

- *Lesson, not item.* A lesson is the unit a visitor reads in the outline and the unit the player shows on one page. A mark per item would let a preview page show half a lesson, would need a rule for an item that moves between lessons, and would make "is this address open" depend on a list. The issue's scope says lessons. Hiding a single item of a marked lesson already works through the item's own `visibility`.
- *Stored only as `true`.* Absent means not marked, by meaning, as `archivedAt` absent means not archived. There is no `false` to backfill onto existing lessons and no code that treats a missing value as something else (constitution VII). Every read compares with `=== true`.
- *Not assignment lessons.* An assignment lesson holds exactly one item, a quiz or an upload assignment (`assignment-lesson-shape`). Neither can be done without an enrolment: an attempt and a submission are student records, which belong to an enrolment (`student-records-enrolled`), and a graded upload needs an instructor to grade it. A preview of one would be an empty page. `kind` is set at creation and never changes, so a condition on the write is enough; nothing can turn a marked lesson into an assignment lesson later.
- *The mark is independent of visibility.* Hiding, archiving, restoring or moving a marked lesson leaves the mark alone; whether it is open is computed (R-3). An instructor can therefore prepare previews in a draft course, and a restore brings back exactly what was there, which is how `visibility` and `archivedAt` already behave.
- *No tie to the price.* Marking is allowed on free and priced courses. A rule "only priced courses have previews" would have to run on every price change, in a different API (`course.setPrice`), for no protection: on a free course anyone can enrol anyway.

**Alternatives**: a mark on each content item (finer, but the half-lesson and moved-item problems above); a `previewLessonIds` list on the course (one read, but a second place that must follow lesson deletes, restores and moves, and a write that touches `course.updatedAt` and its mirror on every instructor); a new value of `visibility` such as `public` (overloads the one attribute every student read path filters on, and would make "hidden but marked" unrepresentable); a required boolean defaulting to `false` (needs a hand backfill of every lesson on every stage for no gain).

## R-2: Which procedures accept a preview lesson without an enrolment

**Decision**: Three new public queries on core-api, and no change to any existing one.

| Operation | Function | What it gives a caller with no enrolment |
|-----------|----------|-------------------------------------------|
| `freePreview.lesson` | shared router | The open preview lesson's title, description and shown items, reduced per type (R-4) |
| `freePreview.videoUrl` | `MediaUrl` | The stream address and caption addresses of one video item of an open preview lesson, with cookies for that version's folder (R-5) |
| `freePreview.fileUrl` | `MediaUrl` | A signed link to one file item of an open preview lesson (R-5) |

All three are built on `publicCourseProcedure` and listed in `PUBLIC_OPERATIONS`. They give the same answer to a signed-out visitor, a signed-in user who is not enrolled, a student whose enrolment has ended and an enrolled student: they never read `ctx.user`.

Everything behind `requireEnrolment` stays as it is, for marked lessons as for any other: `course.view`, `course.myItemCompletions`, `course.myLessonProgress`, `contentItem.complete`, `contentItem.videoUrl`, `contentItem.saveVideoPosition`, `contentItem.fileUrl`, `quiz.view`, `quiz.submitAttempt`, `quiz.myAttempts`, the `assignment` router, the `discussion` router (`requireDiscussionAccess`) and `announcement.list`. A signed-in, not enrolled user who calls `contentItem.videoUrl` for a preview lesson's video gets `FORBIDDEN`, as today; the portal sends them to the preview route instead.

**Rationale**: The issue proposes that "the signed URL procedures allow a preview lesson's media without an enrolment". The code rules out doing that inside the existing procedures. API Gateway skips the Cognito authorizer for exactly the operations in `PUBLIC_OPERATIONS`, and where it is skipped there are no claims and `ctx.user` is undefined, for signed-in callers too. `contentItem.videoUrl` needs `ctx.user.sub` to check the enrolment and to return `resumeAt`. So one operation cannot serve both a signed-out visitor and an enrolled student: public, it loses the student; protected, it never sees the visitor.

Separate operations also make the exception small enough to read. It is a list of three names in one router, one loader that all three call first (R-3), and one test file. `requireEnrolment` keeps a single meaning, and `paid-access.test.ts` keeps passing unchanged and gains cases instead of exceptions (R-9). A branch inside `requireEnrolment` ("or the lesson is a preview") would put the exception on the path of every enrolled read and write, including `contentItem.complete` and `quiz.submitAttempt`, where it must never apply.

`course.previewVideoUrl`, the promo video's query, is the precedent in every respect: public, on `MediaUrl`, cookies for one folder.

**Alternatives**: widening `requireEnrolment` (above); making `contentItem.videoUrl` public and parsing the token by hand inside the procedure when one is present (re-implements the authorizer, and a bug in it is an authentication bypass on the most sensitive read in the API); a separate unauthenticated API or Lambda for previews (a second place for WAF, throttling and CORS that would have to be kept equal to core-api's); returning preview items inside `course.publicView` (it is cached at the edge for five minutes by the page renderer and seeded into the landing page, so an unmarked lesson's text would be served from cache, against "at once").

## R-3: Hidden, archived and draft content is never exposed

**Decision**: One predicate in `core-table`, beside `isShown`:

```ts
isOpenFreePreview({ course, module, lesson }) =>
  course.status === 'published' &&
  isShown(module) && isShown(lesson) &&
  lesson.kind === 'lesson' && lesson.freePreview === true
```

and one loader in core-api, `loadOpenFreePreview(coreTable, { courseId, moduleId, lessonId })`, which gets the three records by key and throws `NOT_FOUND` "This preview is not available" unless the predicate holds. Each of the three queries calls it before anything else. The message and code are the same whether the course is a draft, archived or missing, the module or lesson is hidden, archived or missing, the lesson is not marked, or it is an assignment lesson.

Items are filtered after that: `freePreview.lesson` lists only items with `isShown(item)`; the two signing queries get the item by its full key (`courseId`, `moduleId`, `lessonId`, `contentItemId`) and refuse with the same `NOT_FOUND` unless it exists under that lesson, `isShown(item)`, has the right `type`, and (for a video) has a playable version (`playableManifest`) or (for a file) an `s3Key`.

**Rationale**: `isShown` (visible and not archived) is what every student read path uses, so "hidden or archived" cannot come to mean something different on the preview path. Reading the item by its full key is what stops a caller naming a preview lesson and another lesson's item: under that key it does not exist. The `kind` check is repeated at read time although the write forbids it, so a record that broke the invariant would still open nothing.

A published course only: an enrolled student keeps reading an archived course today, but a preview is an advertisement for a course that can be joined, and the landing page of an archived course is already not found for everyone (public course pages spec, FR-005).

One answer for every refusal means the preview route tells a caller nothing the public outline does not already show. The outline lists the titles of visible lessons of published courses; nothing else has an observable existence.

**Alternatives**: `filterEffectivelyVisible` over the whole curriculum collection (correct, but reads every module, lesson and item of the course for one lesson; the three gets and one keyed query are enough); `FORBIDDEN` for an unmarked lesson and `NOT_FOUND` for a hidden one (distinguishes "exists but hidden" from "does not exist" for hidden lessons, which the public outline never reveals); serving previews of archived courses to match enrolled access (advertises a course nobody can join).

## R-4: What a preview response contains

**Decision**: `freePreview.lesson` returns `{ course: { courseId, title }, lesson: { lessonId, moduleId, title, description? }, items }`, where each item is built by picking fields into its own schema:

| Item type | Fields returned | Not returned |
|-----------|-----------------|--------------|
| `video` | `contentItemId`, `title`, `description?`, `durationSeconds?`, `playable` (a version can be played now) | `s3Key`, `previousS3Key`, `status`, caption attributes, job and upload attributes |
| `text` | `contentItemId`, `title`, `description?`, `body` | — |
| `file` | `contentItemId`, `title`, `description?`, `fileName`, `fileSize`, `mimeType` | `s3Key`, `submissionNonce` |
| `quiz` | `contentItemId`, `title`, `description?`, `questionCount` | `questions`, `answerKey`, `settings`, `quizVersion`, `questionsHash` |
| anything else (`assignment`) | dropped from the list | everything |

Items are ordered by `order`. The procedure builds each object field by field (`asPreviewItem`); it does not spread the record.

**Rationale**: `course.view` passes records through a zod schema and relies on the schema to drop what students must not see. That is acceptable behind an enrolment. For an anonymous response the safer default is the opposite one: nothing leaves unless it is named. A storage key in a public response would not open the object (CloudFront still wants a signature), but it would publish the layout of the media bucket for no purpose.

`playable` replaces `status` so that a video being replaced reads as playable (the previous version plays, as for students) without exposing the replacement's state.

The module's title is not returned: the page has it from `course.publicView`'s outline, which it needs anyway to find the lesson's `moduleId`.

**Alternatives**: reuse `ContentItemSchema` and `asStudentContentItem` (returns `s3Key`, quiz questions and assignment bodies); return the quiz's questions without the answer key (see R-12).

## R-5: How signed access for public viewers is scoped and how long it lives

**Decision**:

- **Video.** `freePreview.videoUrl` signs CloudFront cookies with a custom policy whose resource is the played version's folder (`<prefix>*`, everything up to the slash before `master.m3u8`) and sets them with `Path=/<prefix>`, exactly as `contentItem.videoUrl` and `course.previewVideoUrl` do. Caption tracks are those of the played version (`tracksForPlayback`) and sit in the same folder. The cookies last `FREE_PREVIEW_COOKIE_LIFETIME_SECONDS`, **one hour**, a new constant in `media-keys.ts`; `getSignedCloudFrontCookies` gains an optional lifetime that defaults to today's four hours, so no existing caller changes. The response has no `resumeAt`.
- **File.** `freePreview.fileUrl` returns `getSignedCloudFrontFileUrl(item.s3Key)`: one object, `FILE_URL_LIFETIME_SECONDS` (five minutes), as for an enrolled student.
- **Text** needs no signature: it is in the `freePreview.lesson` response.
- **Sign on play.** The portal asks for a video's address only when the visitor presses play (as `CoursePreview` does for the promo video) and for a file link only when they press download. While a preview page with a playing video stays open it refetches the address every 30 minutes, which renews the cookies without changing the address.

**Rationale**: A signed cookie cannot be taken back; the only control is how little it covers and how soon it dies. One folder means a visitor's cookies fetch one version of one video. One hour, against the four an enrolled student gets, bounds how long a visitor keeps watching a lesson the instructor has just unmarked, hidden or archived, and how long a harvested cookie is worth anything. It is never longer than `SIGNED_COOKIE_LIFETIME_SECONDS`, so `RETIRED_VERSION_DELAY_MINUTES`, which keeps a replaced version's files until the last cookie for it has expired, still covers every preview cookie; a unit test pins that relation.

Most lessons are shorter than an hour, and the refetch covers the ones that are not. A visitor who leaves the tab closed for over an hour presses play again.

**Alternatives**: the same four hours as an enrolled student (simplest, but a four-hour tail after unmarking, and no reason for anonymous access to last as long as paid access); fifteen minutes with frequent renewal (a throttled renewal, at 1 request per second on development, would stop playback mid-lesson); signed URLs for the manifest instead of cookies (HLS players fetch renditions and segments by relative address without the query string, which is why the repo uses cookies); a separate public bucket or prefix that preview videos are copied to (unmarking would mean deleting copies, replacing a video would mean two pipelines, and the copy would be reachable forever by address); re-keying a video's folder on unmark to kill outstanding cookies (a storage move on a visibility change, with enrolled students mid-playback on the old folder).

## R-6: What unmarking does to links already handed out

**Decision**: The three queries read the lesson on every request and nothing in front of them caches (they are API Gateway methods with no cache). So from the first request after the instructor's write commits, `freePreview.lesson`, `freePreview.videoUrl` and `freePreview.fileUrl` answer `NOT_FOUND` for that lesson. The same is true the moment a marked lesson or its module is hidden or archived, or its course archived, without any write to the mark.

What is already out:

| Handed out before the change | After the change |
|------------------------------|------------------|
| The preview address (`/learn/<courseId>/preview/<lessonId>`), bookmarked or shared | Opens a page that says "This preview is no longer available" and links to the course's landing page if the course is still published. No sign-in form, no redirect |
| Video cookies | Work until they expire, at most one hour after they were issued. Not renewed: the renewal is refused |
| A file link | Works for at most five minutes |
| Text on a visitor's screen, a downloaded file, a recording of the video | Cannot be recalled |
| The landing page cached at the edge (crawler content, and the seed data for the portal) | May show the "Free preview" label for up to five minutes. The link leads to "no longer available". No lesson content is in that page |

**Rationale**: "Removes public access at once" is read as "no new access", which the acceptance criterion can test: unmark, request, refused. Revoking what was already issued would need the files to move (R-5), and an hour's tail on a video the instructor chose to publish is a small price for not touching storage on a click. The spec states the tail openly (FR-010, SC-004) so nobody assumes more.

No redirect to the landing page or the sign-in form: an old link should say what happened. Redirecting to sign-in would suggest that signing in helps.

**Alternatives**: a short cache in front of `freePreview.lesson` to absorb traffic (breaks "at once" by the cache's life; the throttle is the protection instead); a version number on the lesson mixed into the signed path (a storage move again); redirecting dead preview links to the landing page (hides the reason, and the constitution's "no redirects for old addresses" applies in spirit).

## R-7: What a preview does not do, and what the page offers instead

**Decision**: The preview path performs no write of any kind and reads nothing about the caller.

| An enrolled student's lesson | A preview |
|------------------------------|-----------|
| Completions, "Mark as done", lesson and course progress | None. No `contentItem.complete` call exists on the page |
| The video resumes where it was left (`saveVideoPosition`, `resumeAt`) | Starts from the beginning each visit. Player preferences (speed, caption choice) are still remembered in the browser, as they are for everyone |
| Quizzes can be attempted | A locked card: title, number of questions, "Enrol to take this quiz" |
| In-video questions (#591) | Not asked; the video plays through |
| The lesson's discussion can be read and posted to | Not shown |
| Counts as student activity on the item (`studentActivityCount`) | Does not |

The page offers instead: the landing page's own `EnrolmentActions` (Enrol now, Buy now with the price, or their sign-in forms, and "Payments are unavailable" when they are), a line saying progress is saved once the visitor enrols, links to the course's other open previews, and a link to the landing page. A signed-in visitor with a current enrolment is sent to `/learn/$courseId/lesson/$lessonId`. After a free enrolment made from the page, the enrolled dialog's button leads to that lesson. A purchase follows the checkout's flow unchanged and returns to the landing page.

**Rationale**: Every student record in the table belongs to an enrolment; `student-records-enrolled` checks it after every e2e test. Saving a position or a completion for a visitor would need either an exception to that check or a second, enrolment-less kind of record that must then be merged on enrolment. Neither is worth it for a look at a lesson. It also keeps the public path read-only, which is what lets it be throttled and reasoned about like `course.publicView`.

The checkout's return address is built by `payment.checkout` from the allowed origin and the course (`/learn/<courseId>?checkout=success`), and the confirming state lives on the landing page. Passing a return path through the checkout to come back to the preview would add a caller-supplied path to a payment redirect. It is left alone.

**Alternatives**: remember a signed-in visitor's position and carry it into the enrolment (records without an enrolment, above); let visitors attempt quizzes without saving (R-12); show discussions read-only (publishes students' names and questions to anonymous callers, which the discussions spec never offered).

## R-8: Abuse and cost

**Decision**: No new control is built. The preview relies on what the public operations already have, and the plan states what that does and does not cover.

- **Request rate.** Listing the operations in `PUBLIC_OPERATIONS` gives each its own API Gateway method with the stage's `publicThrottle` (1 request per second with a burst of 3 on `discava-development`, 20 with a burst of 40 on `discava-production`, per method, across all callers) and the stage's WAF where it is enabled. Over the limit a caller gets 429 before any Lambda runs.
- **Signing only on demand.** A page view costs one `freePreview.lesson` call; signatures are requested on play and on download. A crawler or a link-preview service that loads the page triggers no signing.
- **Hot-linking.** A video cannot be embedded elsewhere: its files need cookies that only this site's API sets (`Domain` is the platform's cookie domain, `HttpOnly`), core-api's CORS answers only the allowed origins, and the media distribution's response headers allow only those origins too (`media-bucket.ts`, `restrictCorsTo`). A file link is a plain signed URL that dies in five minutes, so a link pasted on another site stops working almost at once.
- **Scraping.** Someone can script the public route and download a preview video or file. That is true of any public video, and of every lesson for an enrolled student. The feature does not try to prevent it; it makes sure only what the instructor marked can be taken.
- **Bandwidth.** Delivery of preview videos is paid by the platform, and one signature can stream for an hour. The throttle bounds signatures, not bytes. The exposure equals the promo video's, multiplied by however many lessons instructors mark.

Left open for the maintainer (PR description): whether the public throttle is right for three more operations, and whether a per-visitor WAF rate rule or a cap on marked lessons per course is wanted before launch. The public course pages spec already records that per-visitor limits are a platform-wide follow-up.

**Rationale**: The request pattern is one call per page and one per play, like `course.publicView` and `course.previewVideoUrl`, not one per keystroke as search suggestions were, so the shared public throttle fits and no stage key is added. A quota on marks would be a product rule dressed as a security control; nothing breaks when an instructor marks many lessons.

**Alternatives**: a throttle of its own as `course.publicSuggest` has (justified there by typing traffic; here it would be a stage key nobody needs yet); a CAPTCHA or a required sign-in before playing (defeats "signed-out visitors can watch"); a cap of N marked lessons per course (stated as a possible follow-up; needs a product decision on N).

## R-9: The access invariant, restated with previews as its one named exception

The rule from the checkout spec has two forms, and they are treated separately.

**The data form does not change.** `paid-course-enrolment-paid` (`core-table/src/helpers/invariants/payments.ts`) says: in a course with a price, an enrolment with no order was created before the price. It is about enrolments. A preview creates no enrolment and no other record, so there is nothing for the check to except. Loosening it would be wrong. Its comment gains one sentence: content of a priced course is read without an enrolment only through open preview lessons (`isOpenFreePreview`), which create no record. Two tests are added beside its existing ones: a priced course with a marked lesson and an unpaid, late enrolment is still a violation; a priced course with a marked lesson and no enrolments is not.

**The API form gains cases, not exceptions.** `paid-access.test.ts` runs a table of content procedures as a signed-in student with no enrolment against a priced, published course and expects `FORBIDDEN`. That table is run a second time against a lesson that is an open preview, and must give the same refusals. `contentItem.saveVideoPosition`, `quiz.myAttempts`, `course.myLessonProgress` and `announcement.list` are added to the table if they are not in it. This is the test that would fail if someone later "simplified" by teaching `requireEnrolment` about previews.

**The exception gets its own tests, written as attacks.** `procedures/free-preview.test.ts` holds a refusal matrix: for each of the three queries, every way the target is not an open preview (course draft, archived, missing; module hidden, archived, missing; lesson hidden, archived, missing, unmarked, an assignment lesson that carries the mark) and, for the two signing queries, every way the item is not available under it (missing, hidden, archived, wrong type, not playable, and an existing, shown item that belongs to a different lesson, including a non-preview lesson of the same course). Each must give the same `NOT_FOUND` and must not call the signer. Further tests assert that the cookies' policy names only the item's version folder and expires within an hour, that no response contains a sensitive field (R-4), and that no entity write method is called.

**A new data check states who can carry the mark.** `free-preview-on-ordinary-lesson` in `helpers/invariants/curriculum.ts`: a lesson with `freePreview` present has the value `true` and `kind` `lesson`. Breaking tests: an assignment lesson with the mark, and a stored `false`.

**The e2e scenario tries it for real.** A signed-out browser watches a preview, then calls the preview route for a non-preview lesson's video and file and the enrolled route for the preview lesson's video; all are refused. The table invariants run after every test, which is what proves a preview recorded nothing.

**Where the exception is written down**: the comment above `requireEnrolment` and above the `freePreview` router, the comment on `paid-course-enrolment-paid`, and the design page (`design/public-pages.mdx`), each pointing to `isOpenFreePreview` as the definition.

**Alternatives**: adding "or the lesson is a preview" to `paid-course-enrolment-paid` (the check has no lesson in it; there is nothing to add); a snapshot-level check that no student record exists for a non-enrolled user in a preview lesson (`student-records-enrolled` already says it for every lesson); a static test that enumerates every procedure and asserts which call the signer (brittle; the CDK test that pins `MediaUrl`'s operation list, plus the router test of `PUBLIC_OPERATIONS`, cover the same ground).

## R-10: Whether the crawler page includes preview content

**Decision**: The landing page's rendered outline marks each open preview lesson: the title becomes a link to `/learn/<courseId>/preview/<lessonId>` followed by the text "Free preview". Nothing else changes in the renderer. The preview address itself is not rendered for crawlers: it already matches the renderer's `/learn/<courseId>/<anything>` rule (the plain `index.html` with `noindex`), the robots file already disallows `/learn/*/`, and the site map lists only `/learn/<courseId>`. Tests pin all three for the new address.

**Rationale**: "Where useful for crawlers" (the issue) is the label: it lets a search result or a shared link say the course has free lessons, and it costs one field that `course.publicView` returns anyway. Rendering the lesson's text for crawlers is not useful enough for what it costs. The renderer's responses are cached at the edge for five minutes and search engines keep their own copies for far longer, so an unmarked lesson's text would stay readable in a search engine's cache, against "removes public access at once". It would also need a server-side rendering of Tiptap documents with maths, which the renderer does not have, and would create indexable pages that compete with the landing page for the course's title.

**Alternatives**: render the text items of preview lessons into the landing page (longer page, same cache problem); render the preview page for crawlers and index it (cache problem, new renderer route, duplicate titles); add `isAccessibleForFree` structured data for the course (wrong at course level: the course is not free); leave the outline untouched for crawlers (loses the one cheap signal).

## R-11: The preview page is its own route

**Decision**: A new public route in the student portal, `/learn/$courseId/preview/$lessonId`, with no `requireSignIn`. It loads `course.publicView` (already cached or seeded when the visitor comes from the landing page), finds the lesson in the outline, and only if the outline marks it `freePreview` calls `freePreview.lesson` with its `moduleId`. The existing `/learn/$courseId/lesson/$lessonId` keeps `requireSignIn` and is not touched.

The page's video component is its own small one over the shared `HlsVideo` (sign on play, refetch every 30 minutes, no position saving). It reuses the lesson page's text rendering. It does not use `VideoPlayer`, `MarkAsDone` or the course player hook, all of which call enrolled procedures.

**Rationale**: The enrolled lesson page is built on `course.view` and the completion and position mutations; making it serve visitors would thread "is this a visitor" through every component on it. A second route keeps the signed-in guard on the first and makes the preview page a small read-only page. The address needs no `moduleId` because the outline supplies it, which also means a guessed address for an unmarked lesson is turned away by the page without a request.

**Alternatives**: the same address for both, switching on enrolment (a sign-in guard that sometimes does not apply, on the route that shows paid content); a dialog on the landing page (no address to share, and a video player inside a dialog is poor on phones); `moduleId` in the address (longer, and leaks nothing but is not needed).

## R-12: Quizzes and in-video questions in a preview

**Decision**: A quiz item in a preview lesson is returned as `{ title, description?, questionCount }` and shown as a locked card with "Enrol to take this quiz". Its questions are not sent. In-video questions (#591, specified in parallel) follow the same rule: `freePreview.videoUrl` has its own output schema with no question data, and the preview's player does not ask them.

**Rationale**: The issue says quizzes "are shown but need enrolment to attempt". An attempt is a student record, so it needs an enrolment (R-7); that part is not in doubt. Whether "shown" includes the questions is the open part. Sending them to anonymous callers publishes assessment content, which instructors reuse and students are graded on, in exchange for nothing a visitor can do. A locked card still shows that the lesson has a quiz. It also keeps quiz content behind `quiz.view`, the one procedure that already holds questions and answer keys apart.

**Alternatives**: show the questions read-only (publishes them; flagged in the PR for the maintainer in case that is what "shown" meant); let visitors answer without saving and see a score (needs the answer key evaluated for anonymous callers, an oracle for the answers); leave quiz items out of the list entirely (hides that the lesson has one).
