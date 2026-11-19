---

description: "Task list for public course landing pages and instructor profiles"
---

# Tasks: Public Course Landing Pages and Instructor Profiles

**Input**: Design documents from `/specs/20261118-223240-public-course-pages/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires tests, so they are included:

- unit tests for the helpers, procedures, renderer and constructs;
- invariant checks, with tests that break them;
- portal component tests;
- a `packages/e2e` scenario and a concurrency test.

Write each phase's tests first and watch them fail. Never weaken an existing test to make it pass (constitution IV). Where a task changes an existing assertion on purpose (the `StaticWebsite` snapshot in Phase 7), it says which behavior changed, and the PR description repeats it.

**Who runs what**: An automated agent implements these tasks without `pnpm dev` or Docker. It runs unit and component tests, lint, typecheck, `build` and `synth` locally. The agent writes the e2e scenario and concurrency test, but PR CI runs them (`pr-checks.yml`'s `E2E tests` job). Tasks marked **(human)** need a running local stack, a deployed stage or people, and a reviewer does them before merging.

**Organization**: Eight phases. Each phase is one agent PR, merged in order, and leaves `main` green and working, so no phase needs a later one to pass.

| Label | Story | Priority |
|-------|-------|----------|
| US1 | Decide from the landing page | P1 |
| US2 | Preview video | P1 |
| US3 | Instructor writes the landing page | P1 |
| US4 | Crawlers and shared links | P2 |
| US5 | Instructor profiles | P2 |

Paths are relative to the repository root. Only the last PR closes #287. Earlier PRs say "Part of #287" and must not use a closing keyword.

**Cross-feature order**: The landing page reads `review.summary`/`review.list` (#279) and category labels (#283), both on `main` at `d8acf5d`. If either has changed shape by the time a task runs, the task adapts to `main` and says so in its PR.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)

---

## Phase 1: User Story 3 - Instructors store outcomes and requirements, and the preview record exists (P1) 🎯 MVP

**PR title**: `feat(public-pages): landing page fields on courses, the shared writer and invariants (#287)`

**Goal**: The data layer and instructor-api for the two new course attributes, so instructors can save them through the API, plus the `coursePreview` record and its invariants (nothing writes it yet). The portals do not read any of it yet, so nothing users see changes.

**Independent test**: Procedure tests for `course.updateLanding`; entity and invariant breaking tests.

- [x] T001 [US3] Tests first, then extend `packages/databases/core-table/src/entities/course.ts` with:
  - `learningOutcomes`: list of string, optional;
  - `requirements`: list of string, optional.

  Entity tests in `entities/course.test.ts` (create the file if absent, following `entities/review.test.ts`): a course round-trips both attributes, and the existing course tests stay unchanged.
- [x] T002 [US3] Tests first, then add `packages/databases/core-table/src/helpers/course-landing.ts`, exported from `src/index.ts`, with:
  - `normaliseLandingList(items)`: trims each item, refuses more than 10 items, and refuses any item outside "1 to 160 characters after trimming";
  - `courseLandingWrites.set({ courseId, learningOutcomes, requirements, now })`: returns the transaction items for the course patch (an empty list *removes* the attribute) and one `courseInstructor` patch per instructor, setting `courseUpdatedAt` to the course's new `updatedAt`, as `helpers/course-catalogue.ts` does.

  Tests in `helpers/course-landing.test.ts` (mock entity calls as `helpers/course-catalogue.test.ts` does) cover every item for each case:
  - an 11th item; a 161-character item; a whitespace-only item; trimming;
  - setting and clearing each list;
  - no two items for the same key.
- [x] T003 [US3] Impact-check invariants, tests first. In `packages/databases/core-table/src/helpers/invariants.ts`, add `course-landing-shape` to `INVARIANTS` and `checkTableInvariants`: each list is at most 10 items, each item is 1 to 160 characters and equal to its trimmed form.

  Breaking tests in `invariants.test.ts`: an 11-item list, a padded item, an empty item.

  Extend the `instructor-course-updated-at` tests with a snapshot written by `courseLandingWrites.set` that satisfies it, and one where the sync was left out, which violates it.
- [x] T004 [P] [US3] Stream-consumer confirmation (constitution V). In `packages/databases/core-table/src/helpers/progress-stream.test.ts`, assert that a `course` MODIFY changing only the two new attributes matches no entry of `PROGRESS_STREAM_FILTERS`. In `search-stream.test.ts`, pin the existing behavior that it matches `SEARCH_STREAM_FILTERS`, which is harmless because the document ignores the fields. Also assert that `coursePreview` INSERT, MODIFY and REMOVE records match no entry of either filter list. Change the filters only if a test shows a need, and record the outcome in the PR description.
- [x] T005 [US3] Tests first, then add `packages/apis/instructor-api/src/procedures/course-landing.ts` with `updateLanding` per [contracts/instructor-api-landing.md](./contracts/instructor-api-landing.md):
  - a `courseProcedure` whose zod input enforces "at most 10 items" and "1 to 160 characters after trimming" with messages that name the field and the 1-based position;
  - the caller must be an instructor of the course (`FORBIDDEN` otherwise);
  - one transaction from `courseLandingWrites.set`.

  Register it as `course.updateLanding` in `src/router.ts`. Extend `course.view`'s output schema with `learningOutcomes` and `requirements` (`preview` is added in T052).

  Tests in `procedures/course-landing.test.ts` (pattern: `procedures/course.test.ts`):
  - success in draft, published and archived courses;
  - each validation error;
  - a non-instructor is refused;
  - `[]` clears a list.
- [x] T006 [US2] Tests first, then add `packages/databases/core-table/src/entities/course-preview.ts`, registered in `entities/index.ts` and `service.ts` (not in `curriculum`), per [data-model.md](./data-model.md) "New: `coursePreview`":
  - pk `courseId`, sk constant;
  - `status` `processing` | `ready` | `failed` (required);
  - `s3Key`, `previousS3Key`, `submissionNonce` (required), `mimeType`, `mediaConvertJobId`, `rawObjectETag`;
  - `transcodePending` (`'pending'`) and `transcodePendingSince`;
  - `failureReason` `too-long` | `transcode-error`;
  - `durationSeconds` (required, "1 to 300");
  - the four caption attributes, typed as on `contentItem` (share the schema rather than copy it);
  - `uploadedBy` (required), `createdAt`, `updatedAt`;
  - sparse index `byTranscodePending` on `gsi1pk-gsi1sk-index`, defined exactly as `contentItem`'s.

  Entity tests: out-of-range duration and unknown status refused; `.params()` shows the `byTranscodePending` query cannot return a `contentItem` and the reverse.

  Invariants, tests first: add `course-preview-shape` (data-model.md table) and extend `video-transcode-state` and `caption-tracks-valid` to check `coursePreview` records with the same rules as lesson videos (load `coursePreviews` into `TableSnapshot` in `loadTableSnapshot`). Breaking tests: a preview with no course; 301 seconds; `ready` without `s3Key`; an `s3Key` under another course; `failureReason` while `processing`; `transcodePending` without its timestamp; a caption track for a version not played.
---

## Phase 2: User Story 1 - The landing page shows outcomes, requirements, facts and instructors (P1)

**PR title**: `feat(public-pages): instructor profiles records and the richer course landing page (#287)`

**Goal**: Add profile records (created with each instructor's first course), so cards have names and handles. `course.publicView` returns outcomes, requirements, the category and instructors. The student portal shows the new sections. Depends on Phase 1.

**Independent test**: Signed out, a published course's page shows the new sections and an instructor card. A draft or archived course shows "Course not found" for everyone, including an enrolled student.

- [x] T007 [US1] Tests first, then add `packages/databases/core-table/src/entities/instructor-profile.ts` and `entities/profile-handle-claim.ts`, registered in `entities/index.ts` and `service.ts` (neither joins `curriculum`), per [data-model.md](./data-model.md).

  `instructorProfile` (pk and sk both `instructorId`) has:
  - `instructorId`: required;
  - `handle`: required, "3 to 30 characters, `^[a-z0-9]+(-[a-z0-9]+)*$`";
  - `displayName`: required, "1 to 60 characters";
  - `headline`: "Up to 100 characters";
  - `bio`: "Up to 2,000 characters";
  - `photoKey`;
  - `version`: number, required, default 1;
  - `createdAt` and `updatedAt`, as other entities have.

  `profileHandleClaim` (pk and sk both `handle`) has `handle` and `instructorId` (both required) and a read-only `createdAt`.

  Entity tests refuse each out-of-range field and an invalid handle.
- [x] T008 [US1] Tests first, then add `packages/databases/core-table/src/helpers/instructor-profile.ts`, exported from `src/index.ts`, with:
  - `handleFromName(given, family)`: lower-cases, folds to ASCII (NFKD, strips marks), collapses runs of other characters to one `-`, trims hyphens, cuts to 30 characters without a trailing hyphen, pads names under 3 characters to `instructor`, and never returns a reserved handle (export `RESERVED_HANDLES` with the list in data-model.md "Reserved handles"; the instructor-api validation in T023 imports it);
  - `handleCandidates(base)`: the base, then `-2` to `-9`, then four `base-<4 random [a-z0-9]>` candidates;
  - `defaultDisplayName(user)`: `"<given> <family>"` trimmed, or "Discava instructor";
  - `instructorProfileWrites.ensure({ instructorId, user, candidate, now })`: returns a profile create (condition: not exists) and a claim create (condition: not exists);
  - `ensureInstructorProfile(coreTable, instructorId, { fields?, handle? } = {})`: does nothing if a profile exists (returns `exists`). Otherwise it creates one with `fields` (display name, headline, bio; display name defaulting to `defaultDisplayName(user)`). With no `handle` it tries `handleCandidates` in order and retries only when the claim was taken; with an explicit `handle` it tries only that one and returns `handle-taken` if it is claimed. It is idempotent when the profile was created concurrently.

  Tests in `helpers/instructor-profile.test.ts` cover accented names, emoji, empty names, 40-character names, reserved words, collisions up to the random step, an existing profile, and an explicit handle that is taken (no fallback to a generated one).
- [x] T009 [US1] Impact-check invariants, tests first, in `packages/databases/core-table/src/helpers/invariants.ts`. Add `instructorProfiles` and `profileHandleClaims` to `TableSnapshot` and `loadTableSnapshot` (a scan is allowed in invariant tooling, outside any user request), and add three checks:
  - `instructor-has-profile`: every `courseInstructor.instructorId` has an `instructorProfile`;
  - `profile-handle-claims-consistent`: each profile's handle has exactly one claim, owned by it, and each claim's owner has a profile with that handle;
  - `instructor-profile-shape`: the field rules from T007, plus `version >= 1`.

  Breaking tests in `invariants.test.ts`: a `courseInstructor` with no profile; an orphan claim; a claim owned by someone else; a profile whose handle has no claim; a 61-character display name; a handle of `a--b`.

  Confirm that `packages/e2e/src/helpers/table-invariants.ts` needs no change.
- [x] T010 [P] [US1] Add assertions to `progress-stream.test.ts` and `search-stream.test.ts` that `instructorProfile` and `profileHandleClaim` INSERT, MODIFY and REMOVE records match no filter.
- [x] T011 [US1] Tests first, then call `ensureInstructorProfile` for the caller in `createCourse` (`packages/apis/instructor-api/src/procedures/course.ts`). It runs before the course transaction and is idempotent, so the order is safe: a profile without a course breaks no invariant. Tests:
  - the first course creates exactly one profile and claim;
  - a second course creates none;
  - two instructors named alike get `name` and `name-2`.

  In `packages/common/scripts/src/local-data/`, make the seed create profiles for seeded instructors (Alice). Note in the PR that existing local data is fixed by `reset-local-data` (constitution VII).
- [x] T012 [US1] Tests first, then extend `publicViewCourse` in `packages/apis/core-api/src/procedures/course.ts` and `PublicViewCourseOutputSchema` in `src/schema/course.ts` per [contracts/core-api-public.md](./contracts/core-api-public.md):
  - `learningOutcomes` and `requirements`, as `[]` when unset;
  - `category`: `{ slug, name }` when the course's category exists and is active;
  - `instructors[]`: a `courseInstructor` query by course, sorted by `createdAt`, then one batch get of `instructorProfile`, mapped to `{ handle, displayName, headline?, photoKey? }`. An instructor without a profile is skipped and logged as a warning (the invariant makes that impossible).

  The output schema must strip any instructor or user ID (preview fields come in T018).

  Tests (extend `procedures/course.test.ts`, do not weaken):
  - the new fields;
  - instructor order;
  - the output has no `instructorId` or `userId` even when the stored records have them;
  - draft, archived and unknown courses still give `NOT_FOUND`;
  - a hidden module is still filtered out.
- [x] T013 [US1] Tests first, then update `packages/websites/student-portal/src/routes/learn/$courseId/-components/course-page.tsx` per [contracts/portal-ui.md](./contracts/portal-ui.md):
  - the facts card gains level, language and "<n> hours" when set;
  - a "What you'll learn" section (two-column checked list), placed first;
  - "Requirements" after About;
  - "Instructors" cards in a new `-components/instructor-card.tsx` (photo via `usePublicMediaUrl`, or initials; name; headline; a "View profile" text link to `/instructors/$handle`, rendered as plain text until Phase 5 adds the route), placed before Reviews;
  - `SECTIONS` built from the sections present.

  User text renders as text, never HTML. Component tests in `course-page.test.tsx` cover all sections, the empty sections left out, nav entries matching the sections, and a `<script>` in an outcome rendering as text.
- [x] T014 [US1] Extend or add `packages/e2e/src/scenarios/public-landing-page.e2e.ts` (helpers in `src/helpers/public-pages.ts`):
  1. An instructor (new user via the local OIDC "Someone else" form) creates a uniquely named course and sets outcomes and requirements through `course.updateLanding`, using an API helper since the UI comes in Phase 3. They publish it.
  2. Signed out, open the course page: the sections and the instructor card are visible.
  3. Archive the course: signed out and as an enrolled student, the page shows "Course not found".

  Take `screenshot()` at the landing page and at the not-found page. The invariant check runs after each test.

---

## Phase 3: User Story 3 - Instructors edit the landing page in the portal (P1)

**PR title**: `feat(public-pages): landing page editor and checklist in the instructor portal (#287)`

**Goal**: The instructor portal UI for Phase 1's API (outcomes and requirements; the preview area comes in Phase 5). Depends on Phases 1 and 2.

**Independent test**: An instructor edits outcomes and requirements on a course, sees the checklist, and the public page reflects the edits.

- [x] T015 [US3] Tests first, then add a "Landing page" card to the course settings area under `packages/websites/instructor-portal/src/routes/_authenticated/my-courses_/$courseId/`, next to the catalogue fields card (find where `updateCourseCatalogue` is edited and follow that structure), in `-components/landing-page-card.tsx`:
  - **Lists**: one editable list each for outcomes and requirements, with an "Add" button, "Move up", "Move down" and "Remove" text buttons (no arrow icons), a character counter at "160", and "Add" disabled at "10" items.
  - **Save and Cancel**: Save calls `course.updateLanding`, and server errors show inline.

  Component tests cover editing, reordering, the limits, error display and the preview note.
- [x] T016 [US3] Tests first, then add `-components/landing-page-checklist.tsx` with five lines (outcomes, requirements, preview ready, course image, profile has a headline and photo). Each line shows a tick or an empty mark and links to its fix. It is computed in the client from `course.view` and `profile.get`; until the phases that add them, the preview line (Phase 5) and the profile line (Phase 6) read "Coming soon", and those phases wire them. Show it on the course overview, and add a "View public page" link when the course is published. Component tests: each line in both states; Publish is never disabled by the checklist.
- [x] T017 [US3] Change `packages/e2e/src/scenarios/public-landing-page.e2e.ts` so the instructor sets outcomes and requirements through the new card, not the API helper. Add a `screenshot()` of the card and the checklist.
---

## Phase 4: User Story 2 - The media pipeline processes preview videos (P1)

**PR title**: `feat(public-pages): transcode and caption course preview videos in the media pipeline (#287)`

**Goal**: Every media pipeline handler and local stand-in handles a second target, `coursePreview`, beside lesson videos. Nothing creates preview jobs yet, so behavior is unchanged. Depends on Phase 1 (T006).

**Independent test**: Handler unit tests drive a preview job through complete, failed, too long, stuck, transcribed and cleaned up; every existing lesson-video test passes unchanged, and a regression test per handler shows a job with no `target` behaves exactly as before (plan risk P8).

- [x] T051 [US2] Tests first, then let `submitTranscodeJob` in `packages/apis/instructor-api/src/lib/mediaconvert-client.ts` take a target: `{ target: 'contentItem', courseId, moduleId, lessonId, contentItemId, submissionNonce }` (the current shape, sent *without* a `target` field so in-flight jobs and handlers agree) or `{ target: 'coursePreview', courseId, submissionNonce }`, writing output to `courses/<courseId>/preview/<submissionNonce>/` for a preview. Tests: the lesson job's request is byte-for-byte unchanged; a preview job's metadata and output prefix.
- [x] T046 [US2] Tests first, then make `packages/databases/core-table/src/helpers/caption-tracks.ts` target-aware: every exported writer takes a key that is either a content item's or `{ courseId }` for a `coursePreview`, and patches the matching entity with the same conditions. Tests: each writer for both targets; the lesson-video tests unchanged.
- [x] T047 [US2] Tests first, then make `packages/events/src/media/transcode-complete.ts` and `transcode-outcome.ts` target-aware. The event's `userMetadata` schema accepts both shapes (no `target` means `contentItem`), and `applyTranscodeOutcome` dispatches to the matching record with the same `submissionNonce` and `mediaConvertJobId` conditions, the previous-version cleanup scheduling and the start of automatic captions. For a preview, a transcoded duration over 300 s marks the attempt `failed` with `failureReason: 'too-long'`, keeps `previousS3Key` playable and schedules the over-long output for cleanup. A normal failure sets `failureReason: 'transcode-error'`. Tests: preview ready, replaced-then-ready, failed, too long, stale event; the lesson-video regression test.
- [x] T048 [US2] Tests first, then make `packages/events/src/media/transcode-reconciler.ts` also query `coursePreview.byTranscodePending({ transcodePending: 'pending' })` and handle stuck previews exactly as stuck lesson videos, and `transcode-cleanup.ts` accept a preview payload (`{ target: 'coursePreview', courseId, submissionNonce }`) that deletes `courses/<courseId>/preview/<submissionNonce>/` unless that nonce's version is the record's `s3Key` or `previousS3Key`. Tests for both targets and the lesson regression.
- [x] T049 [US2] Tests first, then make `packages/events/src/media/transcribe-complete.ts` and `transcribe-outcome.ts` resolve the job's target from its tags and write the WebVTT track through the target-aware `caption-tracks.ts` (T046). Tests for both targets and the lesson regression.
- [x] T050 [US2] Tests first, then make the local stand-ins in `packages/events/src/local/transcoder.ts` and `transcriber.ts` carry the target through job metadata and output paths, and report the transcoded duration from the ffprobe call the transcoder already makes, as MediaConvert's output details do, so the too-long check runs locally. Tests in the existing local stand-in test files.

---

## Phase 5: User Story 2 - Instructors upload a preview and anyone can watch it (P1)

**PR title**: `feat(public-pages): course preview upload and anonymous preview playback (#287)`

**Goal**: The instructor procedures and editor for uploading, replacing and removing a course's preview, `course.previewVideoUrl`, and the landing page player. Depends on Phases 2 and 4 (and Phase 3 for the editor card).

**Independent test**: An instructor uploads a preview under 5 minutes; signed out, it plays with captions; a lesson video is still refused signed out; a preview over 5 minutes is refused; removing it brings back the course image.

- [x] T052 [US2] Tests first, then add `packages/apis/instructor-api/src/procedures/course-preview.ts` with `createUploadUrl`, `create`, `replace`, `remove` and `createVideoUrl` per [contracts/instructor-api-landing.md](./contracts/instructor-api-landing.md) `coursePreview.*`, reusing the lesson-video helpers in `content-item-video.ts` (type allowlist, size limit, ETag retry detection, job submission through T051, failure handling) rather than copying them:
  - "A preview can be at most 5 minutes long" for a declared `durationSeconds > 300`;
  - `CONFLICT` "This course already has a preview" from `create`;
  - `CONFLICT` "The preview changed; reload and try again" on a stale `expectedSubmissionNonce`;
  - `remove` schedules cleanup of every version folder and raw upload.

  Register them under `coursePreview` in `src/router.ts`. Add the first four to `INSTRUCTOR_API_DEDICATED_FUNCTIONS.Media` and `createVideoUrl` to `MediaUrl` in `packages/common/constructs/src/app/apis/instructor-api.ts`, and run `pnpm nx run @discava/infra:synth`. Add `preview` (`{ status, failureReason?, durationSeconds, hasPlayableVersion }`) to `course.view`'s output.

  Tests in `procedures/course-preview.test.ts`: every success and error; a non-instructor is refused for each procedure; two concurrent `create`s leave one record; `replace` keeps the previous version; no write touches `course.updatedAt`.
- [x] T018 [US2] Tests first, then add `previewVideoUrl` to `packages/apis/core-api/src/procedures/course.ts` (schemas in `src/schema/course.ts`) per [contracts/core-api-public.md](./contracts/core-api-public.md): a `publicCourseProcedure` that reads `course` and `coursePreview` in parallel and requires course `published` and `playableManifest(preview)` defined; otherwise `NOT_FOUND` "This preview is not available". It signs as `contentItem.videoUrl` does: `getCloudFrontVideoUrl(manifest)` plus `getSignedCloudFrontCookies(prefixKey)` for the played version's folder, plus caption tracks for that version (`tracksForPlayback`), with no `resumeAt`.

  Also add `preview: { durationSeconds }` to `publicView`'s output only when the same conditions hold (one keyed get beside the curriculum query). Put the eligibility check in one function in `src/helpers/course-preview.ts`, used by both.

  Tests:
  - anonymous success;
  - no preview, first upload processing, first upload failed, draft course and archived course each give `NOT_FOUND`;
  - a replacement in progress plays the previous version;
  - the cookie prefix equals the played version's folder;
  - `publicView` has `preview` exactly when `previewVideoUrl` would succeed, and never exposes keys, nonces or `uploadedBy`.
- [x] T019 [US2] Add `'course.previewVideoUrl'` to `PUBLIC_OPERATIONS` in `packages/apis/core-api/src/router.ts`, and to `CORE_API_DEDICATED_FUNCTIONS.MediaUrl` in `packages/common/constructs/src/app/apis/core-api.ts`. Extend `router.test.ts` so it passes with no user. Run `pnpm nx run @discava/infra:synth` and the core-api stack test so every operation keeps an integration.
- [x] T053 [US2] Tests first, then add the **Preview video** area to the Landing page card (`-components/landing-page-card.tsx` from T015) per [contracts/portal-ui.md](./contracts/portal-ui.md), built from the lesson-video upload component: upload with progress, processing and failed states ("This video is longer than 5 minutes" for `too-long`), Replace and Remove text buttons (no arrow icons), a player through `coursePreview.createVideoUrl`, and the help text from the contract. Wire the checklist's preview line (T016) to `preview.status === 'ready'`. Component tests cover each state, the too-long message, and Remove asking for confirmation.
- [x] T020 [US2] Tests first, then in `course-page.tsx`, when `preview` is present, render the shared `HlsVideo` (`packages/common/shadcn/src/components/hls-video.tsx`) in the header in place of `CourseThumbnail`. It shows the course image as the poster, a "Preview this course" label and the duration. The video URL loads from `course.previewVideoUrl` only after the visitor presses play, with captions and the usual controls. Component tests: the poster shows without a query; pressing play triggers exactly one query; with no `preview`, the image shows.
- [x] T021 [US2] Extend `public-landing-page.e2e.ts`. The instructor uploads a short video as the preview through the Landing page card (reuse the upload helpers from `video.e2e.ts`) and waits for the local transcode. Then:
  1. Signed out, press play and wait for `playing`. Take a `screenshot()`.
  2. Signed out, call `contentItem.videoUrl` for a lesson video of the same course and get `UNAUTHORIZED`.
  3. Upload a video over 5 minutes as a replacement and see it refused, with the current preview still playing (generate the long file with the existing ffmpeg test helper, or declare its duration through the API helper if generation is too slow for CI).
  4. Remove the preview. The header shows the image, and `course.previewVideoUrl` gives `NOT_FOUND`.

---

## Phase 6: User Story 5 - Instructor public profiles (P2)

**PR title**: `feat(public-pages): instructor public profiles and the profile editor (#287)`

**Goal**: The profile editor, photo, handle changes, the public profile page and procedure. Depends on Phase 2.

**Independent test**: An instructor edits their profile and photo. The public profile lists only published courses. A profile with no published course gives not found.

- [x] T022 [US5] Tests first, then add to `packages/databases/core-table/src/helpers/instructor-profile.ts`:
  - `instructorProfileWrites.update({ instructorId, version, patch, now })`, conditioned on `version` and incrementing it;
  - `changeHandle({ instructorId, version, from, to, now })`: one transaction of claim create (not exists), old claim delete (condition `instructorId` = caller), and profile update (condition `handle = from` and `version`);
  - `setPhoto`;
  - `classifyProfileCancellation`, giving `handle-taken` or `stale`.

  Tests cover every item and condition. Extend the T009 invariants with a snapshot written by `changeHandle` that satisfies `profile-handle-claims-consistent`.
- [x] T023 [US5] Tests first, then add `packages/apis/instructor-api/src/procedures/profile.ts` with `get`, `update`, `createPhotoUploadUrl` and `updatePhoto` per [contracts/instructor-api-landing.md](./contracts/instructor-api-landing.md):
  - `get` returns a default with `version: 0` and writes nothing when there is no profile; `isPublic` is true if any taught course is `published` (`courseInstructor.byInstructor` and a batch get of courses);
  - `update` validates "1 to 60", "Up to 100" and "Up to 2,000" characters, the handle pattern and reserved words; `version: 0` calls `ensureInstructorProfile(caller, { fields, handle })` with the explicit handle (`handle-taken` → `CONFLICT` "That handle is taken"; `exists` → `CONFLICT` "Your profile changed; reload and try again");
  - errors are `CONFLICT` "That handle is taken" and "Your profile changed; reload and try again";
  - photo procedures mirror `course-image.ts`, with key `instructors/<sub>/<uuid>.jpg` and a 2 MB JPEG limit.

  Register them under `profile` in `src/router.ts`. If course image procedures run in a dedicated function with public media rights, put the photo procedures in the same function in `packages/common/constructs/src/app/apis/instructor-api.ts`; otherwise leave them on the router. Tests in `procedures/profile.test.ts` cover every path, and confirm the caller's `sub` is the only profile key ever used.
- [x] T024 [US5] Tests first, then add `packages/apis/core-api/src/procedures/instructor-profile.ts` with `publicView` (a `publicCourseProcedure`) per the contract:
  - the handle is lower-cased, and a pattern miss gives `NOT_FOUND`;
  - reads go claim → profile → `courseInstructor.byInstructor` → batch get of courses (keep `published`, sorted by `publishedAt` descending, at most 100) → batch get of `courseRating`;
  - no published course gives `NOT_FOUND`.

  Register it as `instructorProfile.publicView` and add it to `PUBLIC_OPERATIONS`, with a `router.test.ts` case. Tests: draft and archived courses never listed; no IDs of people in the output; the three `NOT_FOUND` causes give identical errors.
- [x] T025 [P] [US5] Tests first, then add `packages/websites/student-portal/src/routes/instructors/$handle.tsx` per [contracts/portal-ui.md](./contracts/portal-ui.md): photo, name, headline, bio paragraphs (split on blank lines, rendered as text), and "Courses by <name>" using the catalogue card component. Not found shows "Instructor not found" with a "Browse courses" button. Make the instructor card's "View profile" a `Link` to it. Component tests cover each state and that bio markup renders as text.
- [x] T026 [P] [US5] Tests first, then add `packages/websites/instructor-portal/src/routes/_authenticated/profile.tsx`, and a "Public profile" item in the account menu:
  - fields for display name, handle (showing the address `/instructors/<handle>` live), headline, bio, and a photo using the existing course image crop dialog at a 1:1 aspect, output 512×512;
  - Save;
  - inline conflict messages;
  - the public-status line from `isPublic`.

  Wire the checklist's profile line (T016). Component tests.
- [x] T027 [US5] Concurrency test in `packages/e2e/src/concurrency/profile-handle.e2e.ts`: two new instructors send `profile.update` at the same moment claiming the same new handle. Exactly one succeeds, the other gets `CONFLICT` "That handle is taken", and the invariants pass.
- [x] T028 [US5] Extend `public-landing-page.e2e.ts`:
  1. The instructor fills in the profile and uploads a photo. Take a `screenshot()` of the editor.
  2. Signed out, open the profile from the course's card. Take a `screenshot()`.
  3. Archive the instructor's only published course. The profile gives "Instructor not found".

---

## Phase 7: User Story 4 - Crawlers, social cards, site map and indexing (P2)

**PR title**: `feat(public-pages): server-rendered landing pages for crawlers, site map and robots (#287)`

**Goal**: The page renderer, the CloudFront wiring, the SPA rewrite, the per-stage indexing setting and the portal seeding. Depends on Phases 2, 5 and 6.

**Independent test**: Fetching a published course or profile without JavaScript returns its content, tags and structured data. Unknown, draft and archived addresses return 404 with `noindex`. Outside production, everything carries `noindex`.

- [x] T029 Tests first, then add to `packages/common/infra-config/src/stages.types.ts`, `stages.config.ts` and `env-overrides.ts` the `studentPortal` settings:
  - `allowSearchEngineIndexing`: default `false`; `true` only under `discava-production`;
  - `siteName`: default `"Discava"`;
  - `pageRendererReservedConcurrency`: default `20`, and `5` under `discava-development`.

  Each gets an env override `<STAGE>_INFRA_STUDENT_PORTAL_<FIELD>`. Tests are in `env-overrides.test.ts`.
- [x] T030 Generate the handler with `pnpm nx g @aws/nx-plugin:ts#lambda-function --no-interactive --project=@discava/core-api --name=page-renderer --event=LambdaFunctionUrlSchema --infra=none`. Read `generator-guide` first and keep whatever bundle target it adds. Record in the PR that infra is hand-written (plan Complexity Tracking).
- [x] T031 Tests first, then add `packages/apis/core-api/src/page-renderer/html.ts` with:
  - `escapeHtml`;
  - `jsonForScript`, which writes `<`, `>` and `&` as `<`, `>` and `&`;
  - `metaDescription(text)`, which cuts at 155 characters on a word boundary;
  - `injectIntoTemplate(template, { head, root, pageData })`, which inserts before `</head>`, replaces `<div id="root"></div>`, and throws when either marker is missing.

  Tests feed `</script><script>alert(1)</script>`, quotes and `&` through every helper. Add a test that reads `packages/websites/student-portal/index.html` and asserts both markers exist.
- [x] T032 Tests first, then add `page-renderer/render-course.ts` and `render-profile.ts`, which build the head and root per [contracts/page-renderer.md](./contracts/page-renderer.md):
  - the title, description, canonical, `og:*` and `twitter:*` tags;
  - `robots noindex` when search engine indexing is off;
  - JSON-LD `Course` (with `aggregateRating` only when `ratingCount >= 1`) or `ProfilePage`;
  - the static semantic markup, using the same Tailwind classes as the React header;
  - the page data keyed by tRPC path.

  Snapshot and assertion tests cover a full course, a bare course, a profile, and a hostile string in every field.
- [x] T033 Tests first, then add `packages/apis/core-api/src/helpers/sitemap.ts` with `sitemapEntries(coreTable)`. It reads published courses (`byStatus`, all pages), runs `courseInstructor` queries in parallel with at most 10 in flight, batch-gets profiles, and reads active categories (reuse the category list procedure's query). It returns unique paths with `lastmod`. Also add `page-renderer/robots.ts`, which builds `robots.txt` exactly as the contract gives for search engine indexing on and off. Tests cover a draft course left out, an instructor of two courses listed once, an archived category left out, and both robots variants.
- [x] T034 Tests first, then implement `page-renderer/handler.ts`:
  - **Routing**: route per the contract's table; method other than GET or HEAD → 405.
  - **Procedure calls**: call procedures through `appRouter.createCaller` with an anonymous context built the way `local-server.ts` builds one without a token.
  - **Template**: fetch `index.html` from the website bucket (env `WEBSITE_BUCKET`), revalidated on every request with `If-None-Match` against the cached `ETag` (`304` reuses the body), per the contract's template section. No fixed-time cache.
  - **Host**: from `x-discava-host` only when it matches `ALLOWED_HOSTS` (a comma list, where `*.cloudfront.net` is allowed only when `ALLOWED_HOSTS` is empty), else the first allowed host.
  - **Responses**: status codes and `Cache-Control` per the contract. A dependency failure gives `503` with `no-store` and the plain template.

  Also add `src/local-page-renderer.ts`, serving the same handler over HTTP on port 2026, exported as `LOCAL_PAGE_RENDERER_URL` from `packages/common/server-utils/src/local-dev.ts`. It takes the template from `LOCAL_PORTAL_URLS.student`. Add it to core-api's `dev` target commands in `project.json`.

  Tests in `page-renderer/handler.test.ts`:
  - 200 for a published course and a profile;
  - byte-identical 404 bodies for draft, archived and unknown courses;
  - `/learn/<id>/home` gives the plain shell with `noindex`;
  - a mixed-case handle and a trailing slash render, with a lower-case canonical;
  - a foreign host is ignored;
  - 503 is not cached;
  - a changed `ETag` between two requests on one warm handler renders the new template; a `304` reuses the cached body; a failed template read gives `503`, not the cached body;
  - `X-Robots-Tag` follows `ALLOW_SEARCH_ENGINE_INDEXING`;
  - no response reads cookies or `Authorization`.
- [x] T035 Tests first, then change `packages/common/constructs/src/core/static-website.ts` per [contracts/infra.md](./contracts/infra.md):
  - remove the 404/403 `errorResponses`;
  - add the viewer-request CloudFront Function from new `core/spa-rewrite.js` (JS 2.0: a URI whose last segment has no `.` becomes `/index.html`) to the default behavior;
  - add the optional `extraResponseHeaders` prop to the existing `ResponseHeadersPolicy`.

  A unit test runs `spa-rewrite.js` against `/`, `/learn/x`, `/learn/x/lesson/y`, `/assets/a.js`, `/runtime-config.json` and `/foo.bar/baz`. Update the construct snapshot on purpose, and name in the PR the behavior change: unknown asset paths now 404 instead of returning `index.html`.
- [x] T036 Tests first, then extend `packages/common/constructs/src/app/static-websites/student-portal.ts` with optional `pageRenderer` props, and add a generator-owned-style wrapper in `src/app/lambda-functions/` for the `page-renderer` bundle. The construct sets up:
  - **Function**: Node 22, 512 MB, 10 s, tracing as the APIs do, reserved concurrency from props; env `RUNTIME_CONFIG_APP_ID` (the app *name*), `WEBSITE_BUCKET`, `ALLOW_SEARCH_ENGINE_INDEXING`, `SITE_NAME`, `ALLOWED_HOSTS`.
  - **Function URL and origin**: `AuthType.AWS_IAM` with `FunctionUrlOrigin.withOriginAccessControl`.
  - **Behaviors**: `/learn/*`, `/instructors/*`, `/sitemap.xml` and `/robots.txt`. Each allows GET and HEAD, uses a cache policy keyed on path only that honours origin TTLs up to 300 s, and an origin request policy forwarding `x-discava-host`. Each has a viewer-request function (new `core/forward-host.js`) setting `x-discava-host` from `Host`, and uses the distribution's response headers policy.
  - **Permission**: `s3:GetObject` on `index.html` only, with KMS decrypt when the bucket is encrypted.
  - **Grant hook**: `pageRendererRoleArn` (the role's ARN, not an `IGrantable`; see T037).

  Export from `core/runtime-config.ts` the function that names the AppConfig application, and use it in both places. Construct tests use assertions, not only snapshots. Run `checkov` through `build`, and add only justified `suppressRules`.
- [x] T037 Tests first, then wire it into `packages/infra/src/stacks/websites-stack.ts`:
  - pass `pageRenderer` props from stage config, with `allowedHosts` set to the configured student portal domains;
  - when search engine indexing is off, pass `extraResponseHeaders: { 'X-Robots-Tag': 'noindex' }` for the student portal.

  In `packages/infra/src/stacks/data-stack.ts`, import the renderer's role with `iam.Role.fromRoleArn(this, 'PageRendererRole', websites.studentPortal.pageRendererRoleArn, { mutable: true })`, then call `coreTable.grantReadData(role)` and `runtimeConfig.grantReadAppConfig(role)` on the import, so the policy is created in Data (granting on the Websites role itself makes Websites reference Data, a cycle). Infra tests: production has no `X-Robots-Tag` header and `ALLOW_SEARCH_ENGINE_INDEXING=true`; development has both noindex and `ALLOW_SEARCH_ENGINE_INDEXING=false`; the Data template has an `AWS::IAM::Policy` attached to the renderer role with the table, KMS key (production, where the table is encrypted) and AppConfig statements; the Websites template has no `Fn::ImportValue`. `pnpm nx run @discava/infra:synth` passes for both stages.
- [x] T038 [P] Tests first, then add `packages/websites/student-portal/src/lib/page-data.ts` with `seedFromPageData(queryClient, trpc)`. It reads `#discava-page-data` once, calls `setQueryData` for `course.publicView`, `review.summary`, `review.list` and `instructorProfile.publicView` with the exact keys the components use, and removes the element. Call it in `main.tsx` before the first render. Add `public/og-default.png` (1200×630, the Discava wordmark on a plain background). Component tests: a seeded course page renders with no spinner and no network call; a malformed element is ignored.
- [x] T039 Extend `public-landing-page.e2e.ts` to fetch `LOCAL_PAGE_RENDERER_URL` with Playwright's `request` (no JavaScript):
  - the published course's HTML contains its title, an outcome, a lesson title, the instructor's name, `og:title`, `application/ld+json` and `noindex` (local is closed to search engines);
  - the profile's HTML contains the display name;
  - a draft course gives 404;
  - `/sitemap.xml` lists the course and profile;
  - `/robots.txt` is `Disallow: /`.
- [ ] T040 (human) On a deployed `discava-development`, follow [quickstart.md](./quickstart.md) "Deployed stage" steps 1, 2 and 5. Confirm that AppConfig resolves by application name and that the Data-owned policy on the renderer role works on a first deploy (plan risk P2). Redeploy the student portal with a changed bundle and, within a minute, load a landing page: it must reference the new `/assets/*` files. Time a landing page with `curl -o /dev/null -s -w '%{time_starttransfer}\n'` on a cache miss (first request after an edit) and on a hit, and check the miss against the plan's p95 goal (under 500 ms) and SC-004 (title and header within 2 seconds on an ordinary connection, checked in a browser with network throttling set to "Fast 4G"). Record the results in the PR.

---

## Phase 8: Polish and cross-cutting

**PR title**: `docs(public-pages): document landing pages and profiles; final checks (closes #287)`

- [ ] T041 [P] Add `docs/src/content/docs/en/design/public-pages.mdx`, covering the renderer, caching and freshness, the SPA rewrite, the indexing setting and the preview's exposure rules. Add a short "Your landing page and profile" section to the instructor guide. Link both from the design index. Note "translations pending" in the PR (constitution VIII).
- [ ] T042 [P] Add to CLAUDE.md's Architecture section one line on the page renderer (core-api's second handler, served by the student portal distribution, local port 2026), and add port 2026 to CONTRIBUTING.md's local dev ports if they are listed there.
- [ ] T043 (human) Run [quickstart.md](./quickstart.md) "Local, by hand" steps 1 to 6, saving screenshots to `tmp/screenshots/pr-<number>/`. Time steps 1 and 2 together for someone who has not seen the screens before, and check SC-005 (under 5 minutes).
- [ ] T044 (human) Run quickstart "Deployed stage" steps 3, 4 and 6: link previews in two apps (SC-006), the Rich Results Test, and no visible flash on a hard reload (FR-012).
- [ ] T045 Run `graphify update .`, then `pnpm build`, `pnpm lint` and `pnpm nx affected --target test`. Tick this spec's checklist items, and close #287 from this PR.

---

## Dependencies and order

```text
Phase 1 (US3 data/API, preview record) ──► Phase 2 (US1 page, profile records) ──┬─► Phase 3 (US3 editor) ──┐
                                                                                 ├─► Phase 6 (US5 profiles) │
Phase 1 ──► Phase 4 (US2 pipeline) ─────────────────────────────────────────────┴──────► Phase 5 (US2 upload + playback)
Phases 2, 5 and 6 ──► Phase 7 (US4 crawlers) ──► Phase 8 (polish)
```

- Phase 4 needs only Phase 1, so it can run alongside Phases 2 and 3. Phase 5 needs Phases 2, 3 (the editor card it extends) and 4. Phase 6 needs only Phase 2.
- Phases that touch `public-landing-page.e2e.ts` append their own `test()` blocks; a later PR rebases rather than editing another phase's block. Tests that set landing fields use the card when Phase 3 is on `main` and the API helper otherwise (T014, T017).
- Inside a phase, `[P]` tasks touch different files and can run together. For example, in Phase 2, T010 runs alongside T008. In Phase 4, T048, T049 and T050 can run together once T046 and T047 are done. In Phase 6, T025 and T026 run together once T023 and T024 are done. In Phase 7, T038 runs alongside T031 to T034.

## Implementation strategy

- **MVP**: Phases 1 and 2. Signed-out visitors see outcomes, requirements, facts and instructors on the existing public page, and instructors can set them through the API.
- **Next**: Phase 3 (editor), then Phases 4 and 5 (preview video), the biggest visible gain.
- **Then**: Phase 6 (profiles), and Phase 7, which turns all of it into indexable, shareable HTML.
- Each phase is one PR that leaves `main` green. Only Phase 8 closes #287.
