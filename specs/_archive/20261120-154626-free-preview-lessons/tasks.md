---

description: "Task list for free preview lessons"
---

# Tasks: Free Preview Lessons

**Input**: Design documents from `/specs/_archive/20261120-154626-free-preview-lessons/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires tests, so they're included: unit tests for the rule, the mutation and the three public queries; a new invariant with tests that break it; component tests in both portals; a `packages/e2e` scenario. This feature opens an exception to "unpaid users cannot get paid content", so several tests are written as attacks: they try to reach media that is not an open preview through the preview route (T016, T030) and through the enrolled routes (T015). Write each phase's tests first and watch them fail. Never weaken an existing test to make it pass. `paid-access.test.ts` is extended in T015 and nothing in it is loosened; no existing invariant changes its rule.

**Who runs what**: An automated agent implements these tasks without `pnpm dev` or Docker. It runs unit and component tests, lint, typecheck, `build` and `synth` locally. The agent writes the e2e tests, but PR CI runs them (`pr-checks.yml`'s `E2E tests` job); a CI failure is the feedback for those. Tasks marked **(human)** need a running local stack, a deployed stage or people, and a reviewer does them before merging.

**Organization**: Seven phases, in the order the code needs them (the mark before the route that reads it, the route before the page that calls it), merged in order. Each is one agent PR and leaves `main` green and working, except that Phases 1 and 2 form the first PR (the first story's phase ends the first implementation issue). Paths are relative to the repository root. Only the last PR closes #595; earlier PRs say "Part of #595" and must not use a closing keyword.

| Label | Story | Priority |
|-------|-------|----------|
| US1 | Watch a preview lesson without enrolling | P1 |
| US2 | A preview opens nothing else | P1 |
| US3 | Instructor marks lessons as free preview | P1 |
| US4 | From a preview to enrolling | P2 |
| US5 | Search engines and shared links see which lessons are free | P3 |

US1's backend sits in Phase 3 beside US2's, because the preview route cannot ship without its refusals; US1's own phase is the student portal.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)

---

## Phase 1: Foundational - the mark and the rule

**Goal**: The `freePreview` attribute, the one function that decides whether a marked lesson is open, the signer's shorter lifetime and the invariant, before anything calls them. Nothing users see changes.

**Independent test**: `pnpm nx run @discava/core-table:test -- --run curriculum invariants stream-features` and `pnpm nx run @discava/common-server-utils:test -- --run lesson-media media-keys` pass.

- [x] T001 [P] Test first, then add the optional attribute `freePreview` (`type: 'boolean'`, not required, no default) to `packages/databases/core-table/src/entities/lesson.ts`, with a comment saying, per [data-model.md](./data-model.md): present with the value `true` when an instructor has marked the lesson as a free preview, removed when unmarked, never stored as `false`, only on a lesson of `kind` `lesson`, and that being marked is not being open (see `isOpenFreePreview`). Entity test (in the entity's existing test file, or a new `entities/lesson.test.ts`): a lesson created without it has none; `.params()` of a patch that sets it and of one that removes it show the attribute set and removed.
- [x] T002 [P] Test first, then add `isOpenFreePreview({ course, module, lesson })` to `packages/databases/core-table/src/helpers/curriculum.ts`, beside `isShown`, exported from `src/index.ts`. It returns true only when `course.status === 'published'`, `isShown(module)`, `isShown(lesson)`, `lesson.kind === 'lesson'` and `lesson.freePreview === true` (research R-3). Tests in `helpers/curriculum.test.ts`, one per input that must make it false:
  - course `draft`, course `archived`;
  - module hidden, module archived;
  - lesson hidden, lesson archived;
  - lesson not marked (`freePreview` absent), and `freePreview: false`;
  - lesson of `kind` `assignment` carrying `freePreview: true`;
  - and the one true case.
- [x] T003 [P] Test first, then add `FREE_PREVIEW_COOKIE_LIFETIME_SECONDS = 60 * 60` to `packages/common/server-utils/src/media-keys.ts`, with a comment pointing to research R-5 (anonymous playback of a free preview lesson lasts an hour, so an unmarked lesson stops playing within the hour), and give `getSignedCloudFrontCookies` in `packages/common/server-utils/src/lesson-media.ts` an optional second argument `{ lifetimeSeconds?: number }` that defaults to `SIGNED_COOKIE_LIFETIME_SECONDS` and sets both the policy's `DateLessThan` and the cookies' `Max-Age`. Tests:
  - `media-keys.test.ts`: the constant is 3600 and is not greater than `SIGNED_COOKIE_LIFETIME_SECONDS` (so `RETIRED_VERSION_DELAY_MINUTES` still outlasts every preview cookie);
  - `lesson-media.test.ts`: with no second argument the policy and `Max-Age` are unchanged (the existing assertions stay); with `{ lifetimeSeconds: 3600 }` the policy expires 3600 s from now, `Max-Age=3600`, and the resource and `Path` are still the given prefix only.
- [x] T004 Tests first, then add the invariant `free-preview-on-ordinary-lesson` to `packages/databases/core-table/src/helpers/invariants/curriculum.ts` (and its entry in that file's list): a lesson whose record has `freePreview` has the value `true` and `kind` `lesson`. In `curriculum.test.ts` add `describe('free-preview-on-ordinary-lesson')`, starting from `consistentTable()`:
  - a marked ordinary lesson passes, in a draft course and a published one, visible and hidden;
  - an assignment lesson carrying `freePreview: true` is a violation;
  - a lesson storing `freePreview: false` is a violation.

  `TableSnapshot` already loads lessons, so `snapshot.ts` and `invariants-coverage.test.ts` need no change; confirm it.
- [x] T005 [P] Restate the paid-content rule where it is written (research R-9). In `packages/databases/core-table/src/helpers/invariants/payments.ts`, add one sentence to the comment of `checkPaidCourseEnrolmentPaid`: content of a priced course is read without an enrolment only through open preview lessons (`isOpenFreePreview`), which create no record, so this check has no exception. Do not change the check. In `payments.test.ts`, under `describe('paid-course-enrolment-paid')`, add two cases without touching the existing ones: with a marked lesson in a priced course, an enrolment with no order created after `pricedAt` plus 10 s is still a violation; with a marked lesson and no enrolment, there is none.
- [x] T006 [P] Add a case to `packages/databases/core-table/src/helpers/stream-features.test.ts` (plan, impact check): a `lesson` MODIFY record whose only change is `freePreview` matches the `progress-recalculation` registration's filters and matches none of `search-indexing`, `analytics-update`, `notification-delivery` and `earnings-recording`. Change no filter.
- [x] T007 Run `pnpm nx run @discava/core-table:test` and `pnpm nx run @discava/common-server-utils:test` (run once), lint and typecheck, and fix failures in the code, not the tests. Run `pnpm nx run @discava/tooling-agent:entity-writers`; `entity-writers.json` should not change in this phase.

**Checkpoint**: the mark, the rule and the invariant exist; nothing writes or reads the mark yet.

---

## Phase 2: User Story 3 - Instructor marks lessons as free preview (P1)

**Goal**: An instructor of a course marks and unmarks an ordinary lesson in the course editor and sees a badge. Visitors cannot open anything yet. Needs Phase 1; same PR as Phase 1.

**Independent test**: as an instructor, mark a lesson in a draft and a published course, see the badge, unmark it; an assignment lesson offers no control; a non-instructor is refused.

### Tests for User Story 3 (write first, see them fail)

- [x] T008 [P] [US3] Unit tests for `lesson.setFreePreview` in `packages/apis/instructor-api/src/procedures/lesson.test.ts`, following that file's pattern and [contracts/instructor-api-lesson.md](./contracts/instructor-api-lesson.md) "Tests": every case listed there, including that unmarking removes the attribute and never writes `false`, that the write's condition includes `kind = 'lesson'`, and that `course` and `courseInstructor` are not written.
- [x] T009 [P] [US3] Component tests in `packages/websites/instructor-portal/src/routes/_authenticated/my-courses_/$courseId/-components/lesson/free-preview-button.test.tsx` with `renderWithInstructorApi`, per [contracts/portal-ui.md](./contracts/portal-ui.md) "Instructor portal": each row of the control table and of the badge table; marking calls `lesson.setFreePreview` with `freePreview: true` only after the confirmation and **Cancel** calls nothing; removing calls it with `false` at once; an `ApiError` shows its message; no arrow icon in any button. Extend `course/course-modules.test.tsx`: an ordinary lesson row has the control, an assignment lesson row does not.

### Implementation for User Story 3

- [x] T010 [US3] In `packages/apis/instructor-api/src/schema/lesson.ts` add `freePreview: z.boolean()` to `LessonSchema` and add `SetLessonFreePreviewInputSchema` and its output (`LessonSchema`), exported through `schema/index.ts`. Every procedure that returns a lesson must return `freePreview` as `record.freePreview === true`; find them through the schemas that use `LessonSchema` (the lesson procedures and the instructor course view) and update each mapping, with one assertion per procedure in its existing test.
- [x] T011 [US3] Add `setLessonFreePreview` to `packages/apis/instructor-api/src/procedures/lesson.ts` and register it as `lesson.setFreePreview` in `packages/apis/instructor-api/src/router.ts`, exactly as the contract's "Behaviour" steps 1 to 6: the guards `updateLesson` uses, `BAD_REQUEST` "Assignment lessons can't be free previews" for `kind` `assignment`, no write when the state is already as asked, and one `writeUnderActiveAncestors` transaction whose lesson patch sets `freePreview: true` or removes the attribute, conditioned on `archivedAt` not existing and, when marking, on `kind = 'lesson'`. Add a comment above it that being marked is not being open (see `isOpenFreePreview` in `@discava/core-table`).
- [x] T012 [US3] Add `lesson/free-preview-button.tsx` and `lesson/free-preview-badge.tsx` under `packages/websites/instructor-portal/src/routes/_authenticated/my-courses_/$courseId/-components/`, and mount both on each lesson row in `course/course-modules.tsx` beside `LessonVisibilityButton`, per the contract: **Make free preview** with the confirmation text given there, **Remove free preview** without one, text-only buttons, `apiErrorMessage` on failure, the course refreshed as the visibility buttons do it, and the badge's two texts ("Free preview", "Free preview (not public yet)").
- [x] T013 [US3] Add `packages/e2e/src/helpers/free-preview.ts` and `packages/e2e/src/scenarios/free-preview.e2e.ts` (read `packages/e2e/README.md` first; users and data made by the scenario with unique names; never reset local data; import `test` and `expect` from `helpers/table-invariants.ts` so the invariants run after every test). First test: an instructor creates a course with an ordinary lesson and an assignment lesson, marks the ordinary lesson through the editor (confirming the dialog), sees "Free preview (not public yet)" in the draft and "Free preview" after publishing, sees no control on the assignment lesson, and removes the mark. `screenshot(page, …)` at the confirmation dialog and at the badge.
- [x] T014 [US3] Run `pnpm nx run @discava/instructor-api:test` and `pnpm nx run @discava/instructor-portal:test` (run once), lint and typecheck, and fix failures. Run `pnpm nx run @discava/tooling-agent:entity-writers` and commit `entity-writers.json` if it changed (`lesson` already lists `instructor-api`'s `procedures/lesson.ts`, so no new writer is expected).

**Checkpoint**: lessons can be marked and unmarked; the mark opens nothing yet.

---

## Phase 3: User Story 2 - A preview opens nothing else (core-api) (P1)

**Goal**: The three public `freePreview` queries exist and give an open preview lesson's content to anyone, and every attempt to get anything else through them, or to use a mark on the enrolled routes, is refused. `course.publicView` says which lessons are open. No portal calls them yet. Needs Phase 1.

**Independent test**: `pnpm nx run @discava/core-api:test -- --run free-preview paid-access course-public-view router.test.ts` and `pnpm nx run @discava/common-constructs:test -- --run core-api.test.ts` pass, and `pnpm nx run @discava/infra:synth` succeeds.

### Tests for User Stories 2 and 1 (write first, see them fail)

- [x] T015 [P] [US2] Extend `packages/apis/core-api/src/procedures/paid-access.test.ts` without loosening any case (research R-9): run its table of enrolled procedures a second time with the lesson in the mocked table being an open preview (`freePreview: true`, `kind` `lesson`, visible, in a priced published course) and expect the same `FORBIDDEN` from every one for a signed-in student with no enrolment, and for one whose enrolment is `dropped`. Add `contentItem.saveVideoPosition`, `quiz.myAttempts`, `course.myLessonProgress` and `announcement.list` to the table if they are not in it. Add one case to `packages/apis/core-api/src/helpers/discussion-access.test.ts`: a student with no enrolment is refused by `requireDiscussionAccess` for a lesson that is an open preview, as for any lesson (FR-006). These are the tests that fail if `requireEnrolment` is ever taught about previews.
- [x] T016 [P] [US2] The refusal matrix, in a new `packages/apis/core-api/src/procedures/free-preview.test.ts` (mock the table as `paid-access.test.ts` does, and mock `@discava/common-server-utils/lesson-media`), per [contracts/core-api-free-preview.md](./contracts/core-api-free-preview.md) "Tests" 2 to 5. For each of `freePreview.lesson`, `freePreview.videoUrl` and `freePreview.fileUrl`, called with no user:
  - course `draft`, `archived` and missing; module hidden, archived and missing; lesson hidden, archived, missing, not marked, and an assignment lesson that carries the mark: each is `NOT_FOUND` "This preview is not available", identical in code and message;
  - for the two signing queries: the item missing, hidden, archived, of the other type, a video with nothing playable, and **a real, shown video and file that belong to a different lesson of the same course (a non-preview one) addressed under the preview lesson's IDs**: each the same `NOT_FOUND`;
  - on every refusal the signer functions are never called and `ctx.responseCookies` stays empty;
  - a lesson whose items carry `s3Key`, `previousS3Key`, `captionTracks`, `captionTracksRev`, `answerKey`, `questions`, `settings`, `mediaConvertJobId`, `rawObjectETag`, `submissionNonce`, plus a hidden item and an `assignment` item: `JSON.stringify` of the `freePreview.lesson` response contains none of those values, and neither of those two items;
  - no `create`, `put`, `patch`, `update`, `upsert`, `delete` or transaction is called on any entity by any of the three.
- [x] T017 [P] [US1] Happy-path tests in the same `free-preview.test.ts` (contract "Tests" 1, 4 and 6) and in the existing files:
  - `freePreview.lesson` returns the course's and lesson's titles and a video, a text, a file and a quiz item sorted by `order`, with exactly the fields of `FreePreviewItemSchema` (`playable`, `body`, `fileName`/`fileSize`/`mimeType`, `questionCount`); a signed-in caller gets the identical response; a lesson with no shown items returns `items: []`;
  - `freePreview.videoUrl` returns the manifest address, the played version's caption tracks, `withCredentials` and no `resumeAt`; the signer is called with exactly that version's folder and `{ lifetimeSeconds: FREE_PREVIEW_COOKIE_LIFETIME_SECONDS }`; the `videoPosition` entity is never read; a video being replaced is `playable` and signs the previous version's folder;
  - `freePreview.fileUrl` returns the link from `getSignedCloudFrontFileUrl` called with the item's `s3Key`;
  - `procedures/course-public-view.test.ts`: `publicView` returns `freePreview: true` for a marked ordinary lesson, and `false` for an unmarked lesson and for an assignment lesson carrying the mark; `procedures/course-view.test.ts`: `course.view`'s lessons have no `freePreview` field;
  - `router.test.ts`: `freePreview.lesson`, `freePreview.videoUrl` and `freePreview.fileUrl` exist, are in `PUBLIC_OPERATIONS`, answer a caller with no user, and are the whole of the `freePreview` router.
- [x] T018 [P] [US2] Extend `packages/common/constructs/src/app/apis/core-api.test.ts`: `CORE_API_DEDICATED_FUNCTIONS.MediaUrl` is exactly `contentItem.videoUrl`, `course.previewVideoUrl`, `contentItem.fileUrl`, `assignment.submissionFileUrl`, `freePreview.videoUrl` and `freePreview.fileUrl`; `freePreview.lesson` is served by the shared router; the three new methods have no Cognito authorizer and carry `publicThrottle`'s settings; every other method's authorizer is unchanged.

### Implementation

- [x] T019 [US1] Add `packages/apis/core-api/src/schema/free-preview.ts`, exported through `schema/index.ts`, with `FreePreviewLessonInputSchema`, `FreePreviewItemSchema`, `FreePreviewLessonOutputSchema` and `FreePreviewVideoUrlOutputSchema` exactly as in the contract (every object `.strict()`; the video output is `VideoUrlOutputSchema.omit({ resumeAt: true })` and is this operation's own, with a comment that nothing added to `contentItem.videoUrl`'s output reaches visitors unless added here on purpose, naming #591). In `schema/course.ts` change `PublicLessonSchema` to `LessonSchema.omit({ contentItems: true }).extend({ freePreview: z.boolean() })`; leave `LessonSchema` alone.
- [x] T020 [US2] Add `packages/apis/core-api/src/helpers/free-preview.ts`:
  - `loadOpenFreePreview(coreTable, { courseId, moduleId, lessonId })`: gets the course, module and lesson by key in parallel and returns them when `isOpenFreePreview` holds, else throws `TRPCError({ code: 'NOT_FOUND', message: 'This preview is not available' })`, the same error for every reason;
  - `previewNotAvailable()`, the one place that error is made, used for item refusals too;
  - `asPreviewItem(record)`: builds the item for its `type` by picking each field named in the contract (never by spreading the record), returns `undefined` for a type outside the union.

  Comment at the top: this file is the one named exception to "content needs an enrolment" (research R-2, R-9).
- [x] T021 [US1] Add `packages/apis/core-api/src/procedures/free-preview.ts` with `freePreviewLesson`, `freePreviewVideoUrl` and `freePreviewFileUrl`, on `publicCourseProcedure`, per the contract's "Behaviour" sections:
  - each calls `loadOpenFreePreview` before anything else and never reads `ctx.user`;
  - `lesson` queries the lesson's content items by `contentItem.query.primary({ courseId, moduleId, lessonId })` with every page, keeps those with `isShown`, sorts by `order` and maps through `asPreviewItem`;
  - `videoUrl` and `fileUrl` get the item by its full key (`courseId`, `moduleId`, `lessonId`, `contentItemId`) and refuse with `previewNotAvailable()` unless it is shown, of the right type and playable (`playableManifest`) or has an `s3Key`;
  - `videoUrl` signs as `course.previewVideoUrl` does, with `{ lifetimeSeconds: FREE_PREVIEW_COOKIE_LIFETIME_SECONDS }`, and returns the played version's tracks (`tracksForPlayback`);
  - no write anywhere in the file.
- [x] T022 [US1] Wire it up:
  - in `packages/apis/core-api/src/router.ts` add `freePreview: router({ lesson, videoUrl, fileUrl })` and the three names to `PUBLIC_OPERATIONS`, and extend the comment above the list: these three are the only public operations that return course content, each gated by `loadOpenFreePreview`;
  - in `procedures/course.ts`, `publicViewCourse` sets `freePreview: isOpenFreePreview({ course, module, lesson })` on each lesson it returns;
  - in `procedures/enrolment.ts`, add to the comment above `requireEnrolment` that open preview lessons are read through the `freePreview` router and never through a procedure that calls this function;
  - in `packages/common/constructs/src/app/apis/core-api.ts` add `'freePreview.videoUrl'` and `'freePreview.fileUrl'` to `CORE_API_DEDICATED_FUNCTIONS.MediaUrl`, and update its comment (playback and download links, for enrolled students and for free preview lessons).
- [x] T023 [US2] Run `pnpm nx run @discava/core-api:test`, `pnpm nx run @discava/common-constructs:test` and `pnpm nx run @discava/infra:test` (run once), lint, typecheck and `pnpm nx run @discava/infra:synth`, and fix failures in the code. Update a CDK snapshot only if the three new public methods changed it, and say in the PR description that the only differences are those methods without the authorizer, with the public throttle, and two of them integrated with `MediaUrl`.

**Checkpoint**: the preview route works and is closed to everything but open previews; no page uses it yet.

---

## Phase 4: User Story 1 - Watch a preview lesson without enrolling (student portal) (P1) 🎯 MVP

**Goal**: The landing page labels and links open preview lessons, and a signed-out visitor can open one, play its video, read its text and download its file. Needs Phases 2 and 3.

**Independent test**: signed out, open a published course with a marked lesson, follow "Free preview", press Play, read the text and download the file; change the address to another lesson and get "no longer available".

### Tests for User Story 1 (write first, see them fail)

- [x] T024 [P] [US1] Component tests in `packages/websites/student-portal/src/routes/learn/$courseId/-components/free-preview-item.test.tsx` with `renderWithCoreApi`, per [contracts/portal-ui.md](./contracts/portal-ui.md) "Layout of an open preview":
  - each item row of the table (playable video, video being prepared, text, file, locked quiz with its question count and no start button);
  - `freePreview.videoUrl` is not called before **Play**, and `freePreview.fileUrl` not before **Download**;
  - with fake timers, the video query refetches after 30 minutes while mounted, and a response with the same address does not remount `HlsVideo`;
  - a `NOT_FOUND` from `freePreview.videoUrl` shows "This video is not available";
  - the calls list never contains `contentItem.videoUrl`, `contentItem.fileUrl`, `contentItem.saveVideoPosition`, `contentItem.complete` or `quiz.view`.
- [x] T025 [P] [US1] Component tests in `-components/free-preview-page.test.tsx` (same folder), per the contract's "States":
  - an open preview shows the course title linking to the landing page, the lesson's title and description and its items, with no "Mark as done", no progress and no discussion;
  - `course.publicView` `NOT_FOUND` shows "This preview is no longer available." with no link;
  - a lesson missing from the outline, or present with `freePreview: false`, shows the same message with "View the course", and `freePreview.lesson` is never called;
  - `freePreview.lesson` `NOT_FOUND` shows the same message;
  - a lesson with no items shows "This lesson has nothing to show yet.";
  - signed out, `course.myEnrolment` and `course.view` are never called.
- [x] T026 [P] [US1] Extend `-components/course-page.test.tsx`: in the outline a lesson with `freePreview: true` is a link to `/learn/$courseId/preview/$lessonId` with a "Free preview" badge; a lesson with `freePreview: false` is plain text as before; the existing assertions stay.

### Implementation for User Story 1

- [x] T027 [US1] Add `-components/free-preview-item.tsx` per the contract: a video component of its own over `HlsVideo` (a poster with a text-only **Play** button; the query enabled on press, `refetchInterval` 30 minutes, `refetchIntervalInBackground: true`, `refetchOnWindowFocus: false`, `retry: false`); the text body rendered with the same renderer the lesson page's text items use (extract it from `content-item.tsx` into its own file in `-components/` if it is not already separate, without changing its behaviour); a file row with a text-only **Download** button that requests the link at that moment; the locked quiz card. Do not import `VideoPlayer`, `MarkAsDone`, `useCompleteItem` or the course player hook.
- [x] T028 [US1] Add `-components/free-preview-page.tsx` and the route `packages/websites/student-portal/src/routes/learn/$courseId/preview/$lessonId.tsx` (public: no `requireSignIn`; a comment saying why), per the contract's "Data" and "States": `course.publicView` first, the lesson found in its outline, `freePreview.lesson` only for a lesson the outline marks, `retry: false`. Regenerate `routeTree.gen.ts` with the router generator, not by hand.
- [x] T029 [US1] In `-components/course-page.tsx`, render an outline lesson with `freePreview: true` as a `Link` to the preview route followed by a "Free preview" badge (a `Badge` from `@discava/common-shadcn`, no arrow icon); leave other rows as they are.
- [x] T030 [US2] Extend `packages/e2e/src/scenarios/free-preview.e2e.ts` with the visitor's side, using `helpers/free-preview.ts` and the API helpers in `helpers/api.ts` (a priced course needs `connectLocalStripe`). In a signed-out browser context:
  - the landing page labels only the marked lesson; following the link shows its text, its file and the locked quiz; **Play** starts the video; **Download** saves the file. `screenshot(page, …)` at the outline label, the preview page and the playing video;
  - **attacks, through the API with no token**: `freePreview.lesson`, `freePreview.videoUrl` and `freePreview.fileUrl` for the unmarked lesson are `NOT_FOUND`; `freePreview.videoUrl` and `freePreview.fileUrl` with the marked lesson's IDs and the unmarked lesson's video and file item IDs are `NOT_FOUND`; `contentItem.videoUrl` for the marked lesson's video is `UNAUTHORIZED`;
  - as a signed-in student who is not enrolled: the preview page is the same, and `contentItem.videoUrl`, `contentItem.fileUrl` and `course.view` for the marked lesson are `FORBIDDEN`;
  - a hidden item of the marked lesson is not on the page and its `freePreview.videoUrl` is `NOT_FOUND`;
  - the instructor unmarks the lesson: the next `freePreview.lesson` is `NOT_FOUND` and a reload of the preview address shows "This preview is no longer available." (screenshot); the same after marking again and hiding the lesson, and after archiving the course.

  The table invariants run after every test, which is what shows a preview recorded nothing.
- [x] T031 [US1] Run `pnpm nx run @discava/student-portal:test` (run once), lint and typecheck, and fix failures.

**Checkpoint**: visitors can watch previews; the page does not yet offer enrolment.

---

## Phase 5: User Story 4 - From a preview to enrolling (P2)

**Goal**: The preview page offers the landing page's enrol or buy action, lists the course's other previews, and sends an enrolled student to the normal lesson page. Needs Phase 4.

**Independent test**: on a free course, open a preview as a signed-in student, enrol, choose "Start this lesson" and land on the lesson page with no progress; open the preview address again and be taken straight to the lesson.

### Tests for User Story 4 (write first, see them fail)

- [x] T032 [P] [US4] Extend `-components/free-preview-page.test.tsx` and `-components/enrolment-actions.test.tsx` in `packages/websites/student-portal/src/routes/learn/$courseId/`, per [contracts/portal-ui.md](./contracts/portal-ui.md):
  - the page shows `EnrolmentActions` for the course with its price, and the line "Your progress is saved once you enrol.";
  - "More free previews" lists the outline's other lessons with `freePreview: true`, in order, and is absent when there are none;
  - signed in with an `active` or a `completed` enrolment: the page navigates to `/learn/$courseId/lesson/$lessonId` (use `mockRouter`); with a `dropped` enrolment it stays on the preview; an enrolled student is navigated to the lesson even when `course.publicView` is `NOT_FOUND` (an archived course they still study), because the enrolment is checked before the "no longer available" states;
  - `EnrolmentActions` with `continueTo={{ lessonId }}`: after a successful `course.enrol` the dialog's button reads "Start this lesson" and links to the lesson route; without the prop every existing assertion still passes unchanged;
  - no arrow icon in any button.

### Implementation for User Story 4

- [x] T033 [US4] Add the optional `continueTo?: { lessonId: string }` prop to `EnrolmentActions` in `-components/enrolment-actions.tsx`: when set, the enrolled dialog's link goes to `/learn/$courseId/lesson/$lessonId` with the text "Start this lesson". Change nothing else in the component: the checkout call, its return address and the confirming state stay as the checkout spec defines them.
- [x] T034 [US4] In `-components/free-preview-page.tsx`: mount `EnrolmentActions` (course ID, title, price and `continueTo`) in a "Like what you see?" panel with the progress line; add "More free previews" from the outline; when signed in, read `course.myEnrolment` and, for an `active` or `completed` enrolment, navigate to the lesson route with `replace`.
- [x] T035 [US4] Extend `packages/e2e/src/scenarios/free-preview.e2e.ts`: a new student signs in, opens a preview of a free course, plays the video to its end, and (checked through the API as that student, and by the table invariants after the test) has no completion, progress or saved position; chooses **Enrol now** then **Start this lesson** and is on the lesson page with nothing marked done; opens the preview address again and lands on the lesson page. On a priced course the preview page shows **Buy now** with the price. `screenshot(page, …)` at the enrol panel and at the enrolled dialog.
- [x] T036 [US4] Run `pnpm nx run @discava/student-portal:test` (run once), lint and typecheck, and fix failures.

**Checkpoint**: a preview leads to enrolment and records nothing.

---

## Phase 6: User Story 5 - Search engines and shared links see which lessons are free (P3)

**Goal**: The landing page's crawler content labels and links open preview lessons; the preview address serves no lesson content to crawlers. Needs Phase 3.

**Independent test**: `pnpm nx run @discava/core-api:test -- --run render handler robots sitemap` passes.

- [x] T037 [P] [US5] Tests first, per [contracts/page-renderer.md](./contracts/page-renderer.md) "Tests", in `packages/apis/core-api/src/page-renderer/render.test.ts`, `handler.test.ts`, `robots.test.ts` and `packages/apis/core-api/src/helpers/sitemap.test.ts`: the outline renders the link and "Free preview" for a marked lesson only; a hostile title and hostile IDs are escaped inside the link; `/learn/<courseId>/preview/<lessonId>` returns the plain template with `noindex`, no lesson title and no page data script, and reads nothing from the table; the robots file disallows that address and the site map does not list it.
- [x] T038 [US5] In `packages/apis/core-api/src/page-renderer/render-course.ts`, render an outline lesson with `freePreview: true` as `<li class="text-sm"><a href="/learn/<courseId>/preview/<lessonId>">title</a> <span>Free preview</span></li>`, escaping the title and both IDs with the file's existing helpers; leave other lessons and every other part of the renderer unchanged. Run the tests of T037 and fix failures in the code.

**Checkpoint**: all five stories work locally.

---

## Phase 7: Polish - docs and manual checks

- [x] T039 [P] Docs, English only, under `docs/src/content/docs/en/`:
  - a "Free preview lessons" section in `design/public-pages.mdx`: the mark and `isOpenFreePreview`; why the preview is three public operations of its own and the enrolled procedures are untouched (research R-2); what a response contains (R-4); signing scope and the one-hour life (R-5); what unmarking does and does not do (R-6); that nothing is recorded (R-7); the paid-content rule with open preview lessons as its one named exception and where it is tested (R-9); what crawlers get (R-10); and an operator's note that preview video delivery is paid by the platform and where to watch it (plan risk R7). Add the page's "Spec" link to `specs/_archive/20261120-154626-free-preview-lessons/spec.md` in its existing link style;
  - in `guides/instructor-guide.mdx`: how to mark and unmark a lesson, that assignment lessons can't be marked, that quizzes stay locked, and that removing the mark stops new access at once while a video already playing can run for up to an hour.

  Do not hand-write other locales; run `pnpm nx run @discava/docs:translate` if AWS credentials exist, otherwise say "translations pending" in the PR description.
- [x] T040 Final sweep: run `pnpm nx run-many --target test`, `pnpm lint` and `pnpm build` (including `synth` and `checkov`); confirm no TODO, skipped or loosened test was added, that `paid-access.test.ts` kept every case it had, and that `packages/e2e/README.md`'s list of invariants names `free-preview-on-ordinary-lesson` if it lists the others. Run `pnpm nx run @discava/tooling-agent:validate-tasks` on this file.
- [x] T041 **(human)** Follow [quickstart.md](./quickstart.md) "By hand (local stack)" steps 1 to 20, saving numbered screenshots of the key steps, including any failure, to `tmp/screenshots/pr-<number>/`. Check that a signed-out visitor reaches a playing preview in two actions and within 5 seconds (SC-001), and that marking takes under 30 seconds (SC-006). *(Checked on 2026-11-24 on a local `pnpm dev` stack: the four free-preview scenarios pass, which are steps 1 to 17 and 20 with the consistency check after each, and steps 18 and 19 were checked separately. SC-001: a signed-out visitor reached a playing preview in two actions in 2.8 s (4.2 s on the first run, which includes loading the page); SC-006: marking took 1.0 to 1.3 s. Step 14's note about a deployed stage's cache was checked on the stage under T042.)*
- [x] T042 **(human)** After deploying to `discava-development`, follow quickstart.md "On a deployed stage" steps 1 to 6, which only run there because local dev does not sign media: the preview cookies' `Path` and one-hour expiry; a 403 from CloudFront when they are used for another lesson's manifest; the renewal after 30 minutes; playback ending within the hour after an unmarking; no playback from another origin; 429s under a burst with the landing page still loading (SC-002, SC-004, FR-016). *(Checked on discava-development on 2026-11-24 in #1020. Step 5 was checked from response headers, not by playing a video on another origin. Step 6 also returned 500s on dev, from the stage's concurrency cap of 10, which production does not set; the 429s and the landing page held.)*
- [x] T043 **(human)** The maintainer confirms the defaults this spec chose without asking (spec "Clarifications", research R-5, R-8, R-10, R-12): quizzes shown locked without their questions; a one-hour playback permission that is not revoked on unmarking; no limit on marked lessons and previews allowed on free courses; nothing recorded for a visitor; search engines get the label only; the shared public throttle with no per-visitor limit. A changed answer is an amendment to this spec before the phase it affects is merged.

---

## Dependencies

- Phase 1 → Phase 2 (same PR) → Phase 3 → Phase 4 → Phase 5. Phase 6 needs Phase 3 only and can be built alongside Phases 4 and 5; merge in numeric order. Phase 7's T039 can start after Phase 3; T040 to T043 come after Phase 6.
- Phase 3 does not need Phase 2's code (its tests write the mark into a mocked table), but merges after it so that `main` never has a public route for a mark nobody can set.
- Within Phase 1: T001, T002, T003, T005 and T006 in parallel; T004 after T001; T007 last.
- Within Phase 2: T008 and T009 in parallel; T010 → T011 → T012 → T013 → T014.
- Within Phase 3: T015 to T018 in parallel; T019 → T020 → T021 → T022 → T023.
- Within Phase 4: T024 to T026 in parallel; T027 → T028 → T029 → T030 → T031.
- Within Phase 5: T032; then T033 → T034 → T035 → T036.
- Within a phase, tests come first, and tasks run in ID order except those marked [P].
- This spec needs the Stripe checkout spec's Phases 1 to 7 (prices, the unpaid-enrolment refusal, the purchase and the landing page's Buy now) and the public course pages spec's landing page and renderer; all are on `main`. It does not wait for checkout's Phases 9 to 14.

## Requirement coverage

| Requirement | Tasks |
|-------------|-------|
| FR-001 mark and unmark; refusals | T001, T008, T010, T011 |
| FR-002 one definition of "open" | T002, T020 |
| FR-003 what a visitor gets | T017, T019, T021, T024, T027 |
| FR-004 same response for every caller | T017, T021, T030 |
| FR-005 scope and life of playback and download | T003, T017, T021, T024, T027, T042 |
| FR-006 enrolled routes still refuse | T015, T030 |
| FR-007 one refusal for everything not open | T016, T020, T030 |
| FR-008 nothing sensitive in a response | T016, T019, T020 |
| FR-009 nothing recorded; no discussion | T016, T024, T025, T035 |
| FR-010 closed at once; old addresses | T016, T025, T028, T030, T042 |
| FR-011 outline label and link | T017, T022, T026, T029 |
| FR-012 preview page: enrol action, other previews | T032, T034 |
| FR-013 enrolled students and what follows enrolling | T032, T033, T034, T035 |
| FR-014 editor control and badge | T009, T012, T013 |
| FR-015 crawler content | T037, T038 |
| FR-016 WAF, throttle, no embedding | T018, T022, T042 |
| FR-017 the paid-content rule restated | T004, T005, T015, T016, T022, T039 |
| FR-018 runs locally | T013, T030, T035, T041 |
| FR-019 not added | T043 (scope confirmed), none built |
| SC-001, SC-006 | T041 |
| SC-002, SC-003 | T016, T030 |
| SC-004 | T030, T042 |
| SC-005 | T016, T035 |
| SC-007 | T032, T035 |
| SC-008 | T037 |

## Parallel examples

```text
Phase 1:  T001 (attribute)  ║  T002 (rule)  ║  T003 (signer lifetime)  ║  T005 (rule's comment and tests)  ║  T006 (stream)
Phase 2:  T008 (mutation tests)  ║  T009 (control tests)
Phase 3:  T015 (enrolled routes still refuse)  ║  T016 (refusal matrix)  ║  T017 (happy path)  ║  T018 (CDK)
Phase 4:  T024 (items)  ║  T025 (page)  ║  T026 (outline)
```

## Implementation strategy

- **MVP**: Phases 1 to 4, three PRs. Instructors mark lessons, and visitors watch them from the landing page with nothing else opened. The security-bearing PR is Phase 3: review its refusal matrix (T016) and the extended `paid-access.test.ts` (T015) before anything else in it.
- **Then**: Phase 5 (the enrol and buy panel, and the redirect for enrolled students) and Phase 6 (the crawler label), each a small PR.
- **Finally**: Phase 7's docs, the reviewer's local and deployed checks, and the maintainer's confirmation of the defaults. T042 is the only check of the signatures themselves, so do it before telling instructors the feature exists.
- Every phase runs `pnpm nx affected --target build` before its PR is opened and stays within its phase's files.
