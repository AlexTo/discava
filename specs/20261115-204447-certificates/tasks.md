---

description: "Task list for course completion certificates"
---

# Tasks: Course Completion Certificates

**Input**: Design documents from `/specs/20261115-204447-certificates/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires them, so they are included: unit tests for the helper, the ID generator, the PDF builder, each procedure and the recalculation step; invariant checks with tests that break them; a `packages/e2e` scenario and a concurrency test. Write each phase's tests first and see them fail. Never weaken an existing test to make it pass (constitution IV).

**Who runs what**: an automated agent implements these tasks without `pnpm dev` or Docker. It runs unit and component tests, lint, typecheck, `build` and `synth` locally. The e2e scenario and concurrency test are written by the agent but run on PR CI (`pr-checks.yml`'s `E2E tests` job). Tasks marked **(human)** need a running local stack or people, and are done by a reviewer before merging.

**Organization**: Six phases, each one agent PR, merged in order (each phase leaves `main` green and working: no phase needs a later one to pass). Story labels: US1 issuing (P1), US2 My Learning (P1), US3 public verification (P1), US4 instructor setting (P2). Paths are relative to the repository root. Only the last PR closes #276; earlier PRs say "Part of #276" and must not use a closing keyword.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)

---

## Phase 1: Certificate record and issuing helper (PR 1)

**PR title**: `feat(certificates): certificate record, issuing helper and invariants (#276)`

**Goal**: the data layer: entity, course flag, the one writer, its invariants. Nothing calls the helper yet, so behavior is unchanged.

- [ ] T001 [US1] Test first, then add `packages/databases/core-table/src/entities/certificate.ts` and register it in `entities/index.ts` and `service.ts`, per data-model.md: attributes `userId`, `courseId`, `certificateId`, `learnerName`, `courseTitle`, `completedAt`, `issuedAt` all required, and all but `userId`/`courseId` read-only; primary index pk `userId`, sk `courseId`; index `byCertificateId` on the existing `gsi1pk-gsi1sk-index` with `gsi1pk` composite `certificateId` and `gsi1sk` a constant. Add `certificatesEnabled` (optional boolean, absent reads as on) to `entities/course.ts` with a comment saying so. Entity test in `entities/certificate.test.ts`: a record missing any required attribute is refused, and using ElectroDB's `.params()` shows the `byCertificateId` query targets `gsi1pk-gsi1sk-index` with a key no `enrolment` key can equal (plan risk R2: a certificate-ID query can never return an enrolment).
- [ ] T002 [US1] Test first, then add `packages/databases/core-table/src/helpers/certificate.ts` (exported from `src/index.ts`): `generateCertificateId()` (10 bytes from `crypto.randomBytes`, 16 Crockford base32 characters, no dashes), `formatCertificateId` (`XXXX-XXXX-XXXX-XXXX`), `normaliseCertificateId` (strip dashes and spaces, uppercase, map `O`→`0`, `I` and `L`→`1`; returns `undefined` unless exactly 16 characters of the alphabet), `learnerName(user)` (given and family names joined by one space, trimmed; "Discava learner" if neither; never the email). Tests in `helpers/certificate.test.ts`: length and alphabet over many generated IDs, no ambiguous characters (`I L O U`), no collisions in 10,000 IDs, format and normalise round-trip, lowercase and dash-less input, rejects 15 and 17 characters and bad characters, name cases (both, one, none, whitespace only, email never used).
- [ ] T003 [US1] Test first, then add `issueCertificate({ coreTable, enrolment, course, user, now })` to `helpers/certificate.ts` per data-model.md "Rules": nothing unless the enrolment is `completed` with a `completedAt` and not `dropped`, and `course.certificatesEnabled !== false`; return the existing certificate if there is one; otherwise generate an ID, query the `byCertificateId` index and regenerate on a hit (up to 5 tries, then throw), then `create` conditioned on the key not existing, with `learnerName` from `learnerName(user)` (a missing user gives the fallback), `courseTitle` from the course, `completedAt` from the enrolment and `issuedAt` from `now`; on a conditional-check failure, read and return the existing record. It is the only writer of `certificate`. Tests in `helpers/certificate.test.ts` (mock the entity calls as `helpers/assignment-submission.test.ts` does): each refusal case writes nothing; a second call returns the first call's ID without a second create; two concurrent calls where one create loses its condition return the winner's record; an ID collision on the index regenerates; five collisions throw; a missing user uses the fallback name.
- [ ] T004 [US1] Impact-check invariants, tests first. In `packages/databases/core-table/src/helpers/invariants.ts` add `certificates` to `TableSnapshot` and load them in `loadTableSnapshot` (a scan is allowed here: invariant tooling, outside any user request; confirm `packages/e2e/src/helpers/table-invariants.ts` needs no change). Add two names to `INVARIANTS` and to `checkTableInvariants`: `certificate-shape` (ID is 16 characters of the Crockford alphabet, IDs unique across certificates, `learnerName`, `courseTitle`, `completedAt` and `issuedAt` present, `issuedAt >= completedAt`) and `certificate-has-completed-enrolment` (an enrolment exists for the student and course with status `completed` and the same `completedAt`, and the course exists). A certificate in a course with `certificatesEnabled: false`, and a completed enrolment without a certificate, are NOT violations. Breaking tests in `invariants.test.ts`: a bad ID, a duplicate ID, a missing name, `issuedAt` before `completedAt`, no enrolment, an `active` or `dropped` enrolment, a different `completedAt`, a missing course; plus the two non-violations above, and a test that a student whose only record is a certificate does not count in `activity-count-matches-students` and trips none of the `student-records-*` checks.

---

## Phase 2: Issue certificates on completion (PR 2)

**PR title**: `feat(certificates): issue a certificate when a course is completed (#276)`

**Goal (US1)**: the recalculation calls the helper, so completing a certificate-enabled course creates exactly one certificate. Depends on PR 1.

**Independent test**: the recalculation's unit tests; the e2e check comes in PR 6.

- [ ] T005 [US1] Test first, then call `issueCertificate` from `recalculateStudent` in `packages/events/src/progress/recalculate.ts` (plan R-1, R-2): after the progress and enrolment writes, when the student is not dropped and the result is completed or the enrolment is already `completed`, read the student's `certificate` for the course (one keyed get); only if none exists, read the `course` and `user` (two keyed gets) and call `issueCertificate` with the enrolment as just completed (use the `completedAt` written this pass, or the stored one). Do not read the course or user for in-progress students or students who already have a certificate. An error from `issueCertificate` propagates (the batch is retried; never swallowed). Add `@discava/core-table` direct dependencies the events project lacks (CLAUDE.md TS2883 note). Tests in `progress-recalculation.test.ts` (and `recalculate.test.ts` if it exists, else create it): completing issues one certificate dated with the enrolment's `completedAt`; a student who is not complete issues none and makes no course or user read; certificates off issues none; a dropped student issues none; an already-completed student without a certificate (a retry after a failure, or one who completed while certificates were off and has them on now: spec Assumptions) gets one; an already-issued student makes no course or user read and no write; a thrown error from the helper fails the recalculation; the existing cases pass unchanged.
- [ ] T006 [P] [US1] Stream-consumer confirmation (constitution V, plan Impact check), tests first. Add an assertion to `packages/databases/core-table/src/helpers/progress-stream.test.ts` that a `certificate` INSERT matches no entry of `PROGRESS_STREAM_FILTERS`, and to `search-stream.test.ts` that a `certificate` INSERT matches no entry of `SEARCH_STREAM_FILTERS`. Read `helpers/search-stream.ts` and `packages/events/src/search/` to confirm a `course` MODIFY that only changes `certificatesEnabled` does not change what search reads: if search indexes every course attribute or re-indexes on any change, either assert it harmlessly re-indexes the same document (add a test) or exclude the attribute; record the outcome in the PR description. Update the filters only if a test shows they need it.
- [ ] T007 [US1] Confirm the deployed recalculation Lambda can read and write the core table: check the `progress-recalculation` grant in `packages/infra/src/stacks/core-api-stack.ts` (`createProgressRecalculationLambda`) and the local event runner `packages/events/src/local/event-runner.ts` path both reach `recalculateStudent` unchanged. Run `pnpm nx run @discava/infra:synth` and note in the PR that no stack change was needed (or make the smallest grant change and add a synth assertion test beside the existing ones).
- [ ] T008 [US1] Concurrency-relevant unit test in `packages/events/src/progress/recalculate.test.ts`: two `recalculateStudent` calls for the same completing student run with `Promise.all` against an in-memory fake that enforces the conditional create; assert exactly one certificate exists and both calls resolve with the same ID, including the case where the loser lost the enrolment patch's `status = 'active'` condition and the case where the winner's issue step failed once and a retry issued it.

---

## Phase 3: Public verification and learner API (PR 3)

**PR title**: `feat(certificates): verify, list and download certificates in core-api (#276)`

**Goal (US3, US2 API)**: the three procedures of [contracts/core-api-certificate.md](./contracts/core-api-certificate.md). Depends on PR 1 (the table and helper); can merge before or after PR 2, but certificates exist only after PR 2.

**Independent test**: procedure tests with a mocked core table; public access test in `router.test.ts`.

- [ ] T009 [P] [US2] Test first, then add `packages/apis/core-api/src/helpers/certificate-pdf.ts` with `drawCertificatePdf({ learnerName, courseTitle, completedAt, certificateId, verifyUrl })` returning bytes (add `pdf-lib` as a direct dependency of `packages/apis/core-api/package.json`, `pnpm i`): one landscape A4 page, standard fonts, heading, learner, course, date, ID in display form, verification URL; text is sanitised to what WinAnsi can draw with other characters replaced by `?`, and long names and titles shrink to fit one page. Tests in `helpers/certificate-pdf.test.ts`: the output starts with `%PDF`, loads back with `PDFDocument.load` with exactly one page, and does not throw for an accented name, a CJK name, an emoji title, a 300-character title and an empty-string name (the last is a refused input only if the schema forbids it: assert the function itself does not throw).
- [ ] T010 [US3] Test first, then add `packages/apis/core-api/src/schema/certificate.ts` and `procedures/certificate.ts` with `verify` per the contract: a `publicProcedure` on `publicCourseProcedure`'s table plugin (as `course.publicView` does), input normalised by `normaliseCertificateId`; `NOT_FOUND` "Certificate not found" for a malformed ID (no table read) and for an unknown ID (identical message); queries the `byCertificateId` index and returns exactly `{ certificateId (display form), learnerName, courseTitle, completedAt }`. Tests in `procedures/certificate.test.ts`: found, lowercase and dash-less found, malformed with the table never called, unknown, identical error for both, and a test that the output has exactly those four keys even when the stored record has `userId`, `courseId` and `issuedAt`.
- [ ] T011 [US3] Add `certificate.verify` to `PUBLIC_OPERATIONS` in `packages/apis/core-api/src/router.ts` and mount the `certificate` router; extend `packages/apis/core-api/src/router.test.ts` (it checks the list against how each procedure treats an anonymous caller) so `certificate.verify` passes with no user and `myCertificates` and `pdf` are `UNAUTHORIZED` without one. Check `packages/common/constructs/src/app/apis/core-api.ts` for how the authorizer-skipping routes are derived from `PUBLIC_OPERATIONS` and edit it only if a list is hand-kept there; run `pnpm nx run @discava/infra:synth`.
- [ ] T012 [US2] Test first, then add `myCertificates` and `pdf` to `procedures/certificate.ts`: both `protectedProcedure`s on the table plugin; `myCertificates` queries the primary index by `ctx.user.sub` and returns `{ certificateId (display), courseId, courseTitle, learnerName, completedAt }[]`, most recent first; `pdf` takes `{ courseId }`, gets `{ userId: ctx.user.sub, courseId }`, `NOT_FOUND` if none, otherwise returns `{ fileName: 'certificate-<ID>.pdf', contentBase64 }` from `drawCertificatePdf`. The verification URL (plan R1) is built from `getAllowedOrigin` (`@discava/common-server-utils/cors`) on the request if the procedure context exposes the API Gateway event; if it does not, extend the context minimally (read `src/init.ts`, `src/handler.ts`, `src/local-server.ts`), and if that is not small, print `/certificates/<ID>` with the site name and record the choice in the PR. Tests: the list is the caller's only (another student's certificate is never returned), most recent first; `pdf` for another student's course is `NOT_FOUND` and the table is queried with the caller's `sub` whatever the input; the PDF bytes decode and the verification URL appears for an allowed origin; works for an archived course's certificate (the course record is not read).

---

## Phase 4: Instructor setting (PR 4)

**PR title**: `feat(certificates): let instructors turn certificates on or off per course (#276)`

**Goal (US4)**: [contracts/instructor-api-course-setting.md](./contracts/instructor-api-course-setting.md) and the switch. Depends on PR 1 only.

- [ ] T013 [US4] Test first, then add `course.setCertificates` to `packages/apis/instructor-api/src/procedures/course.ts` and its router entry, on `courseProcedure`, input `{ courseId, enabled }`: patches `certificatesEnabled`, moves `course.updatedAt` and each instructor's `courseUpdatedAt` exactly as the other course edits in that file do, allowed in any course status, returns the course with `certificatesEnabled` (absent in storage returned as `true`). Add `certificatesEnabled` to the course schema in `packages/apis/instructor-api/src/schema/` and to what the instructor course read procedures return. Tests in `procedures/course.test.ts` (follow its pattern): an instructor of the course can turn it off and on; a non-instructor and a user outside the instructor group are refused; a draft and an archived course can be changed; `updatedAt` and `courseUpdatedAt` are moved; existing certificates are never read or written (the entity mock is not called); an unset value is returned as `true`.
- [ ] T014 [US4] Extend the `instructor-course-updated-at` check's breaking test (impact check) in `packages/databases/core-table/src/helpers/invariants.test.ts`: a setting change that did not move `courseUpdatedAt` for an instructor is a violation. Only change the check in `invariants.ts` if it cannot already see this write.
- [ ] T015 [US4] Test first, then add the switch "Issue a certificate on completion" and its note to the course settings screen in `packages/websites/instructor-portal/src/routes/` (find the course settings component first; follow [contracts/student-portal-ui.md](./contracts/student-portal-ui.md) "Instructor portal"), calling `course.setCertificates`; a text label only, no arrow icons. Component test beside it with `renderWithInstructorApi`: shows the current state (an unset value shows on), clicking calls `course.setCertificates` with the new value, a failing call (`ApiError`) shows an error and restores the switch.

---

## Phase 5: Student portal pages (PR 5)

**PR title**: `feat(certificates): show, download and verify certificates in the student portal (#276)`

**Goal (US2, US3 UI)**: [contracts/student-portal-ui.md](./contracts/student-portal-ui.md). Depends on PR 3.

- [ ] T016 [US3] Test first, then add the public route `packages/websites/student-portal/src/routes/certificates/$certificateId/index.tsx` (signed out reachable: no sign-in redirect, as the catalogue's public routes) calling `certificate.verify`, with the states loading, found, not found and error from the UI contract; found shows name, course title, long date and ID, nothing else. Test in `-certificate.test.tsx` (the `-` prefix keeps TanStack Router from treating it as a route; render `Route.options.component`): found content, not found text "Certificate not found", loading shows no learner data, error is retryable, and no email or user ID appears. Regenerate `routeTree.gen.ts` as the repo does (`pnpm nx run @discava/student-portal:build`, then commit the generated file if tracked).
- [ ] T017 [US2] Test first, then add the Certificate control to My Learning in `packages/websites/student-portal/src/routes/my-learning/index.tsx` (extract a component in the same folder): reads `certificate.myCertificates` once, and for each completed course with a certificate shows View (opens `/certificates/<ID>` in a new tab), Download PDF (calls `certificate.pdf`, decodes base64 to a Blob and saves `fileName`, "Preparing" while waiting, a retryable error on failure) and Copy link (copies `window.location.origin` plus the path, shows "Link copied"); text-only buttons. Tests in `-my-learning.test.tsx` (existing file; extend, do not weaken): the control appears only for courses with a certificate, copy writes the expected URL to the mocked clipboard, download calls `certificate.pdf` with the course ID and triggers a save, a failed download shows an error, and a failing `myCertificates` call does not break the rest of the page.
- [ ] T018 [P] [US3] Ensure signed-out access end to end at the portal level: check the student portal's route guards in `packages/websites/student-portal/src/routes/__root.tsx` and `src/router.ts` and the tRPC client setup (`src/lib/`), so a signed-out visit to `/certificates/<ID>` makes the unauthenticated call without a Cognito redirect or a failing auth header; fix and test (in `-routes.test.tsx`) only what blocks it. If nothing blocks it, say so in the PR.

---

## Phase 6: End-to-end, docs and manual checks (PR 6, closes #276)

**PR title**: `feat(certificates): certificate end-to-end tests and docs (closes #276)`

**Goal**: acceptance criteria of the issue: the e2e learner download flow and the exactly-once guarantee under concurrency. Depends on PRs 2 to 5.

- [ ] T019 [US1] [US2] [US3] Add `packages/e2e/src/helpers/certificate.ts` (create a published course with one item for a fresh instructor, enrol a fresh student, complete it, wait for the certificate with polling, the way `helpers/` do for progress) and `packages/e2e/src/scenarios/certificate.e2e.ts`: the student completes the course and My Learning shows the Certificate control; Download PDF yields a file whose bytes start `%PDF`, whose text contains the learner, course title and ID (read the downloaded file); a signed-out browser context opens the Copy link URL and sees name, course, date and ID but no email; a changed ID shows "Certificate not found". Users and data are made by the scenario with unique names; never reset local data; keep the invariant check after every test (read `packages/e2e/README.md` first).
- [ ] T020 [US4] Add a second scenario in `certificate.e2e.ts`: the instructor turns certificates off, a second fresh student completes the course and My Learning shows no certificate control, and the first student's certificate still verifies; then on again and a third student gets one.
- [ ] T021 [US1] Add `packages/e2e/src/concurrency/certificate-issue.e2e.ts` (follow the existing files in `src/concurrency/`): complete a student's final item, then fire several recalculation-triggering actions at the same moment (a curriculum edit by the instructor that changes visibility, plus the completion) and, once progress has settled, assert the student has exactly one certificate with one stable ID (via the signed-in `myCertificates` call) and that the invariant check passes.
- [ ] T022 [P] Docs, English only, under `docs/src/content/docs/en/` (find where learner and instructor guides live and add or extend a page): how certificates are issued, the per-course switch, what the public page shows, how to share and verify, the limitations (no backfill, no revocation, non-Latin characters in the PDF print as `?`). Do not hand-write other locales; run `pnpm nx run @discava/docs:translate` if AWS credentials exist, otherwise say in the PR description "translations pending".
- [ ] T023 [P] Final sweep: run `pnpm nx run-many --target test`, `pnpm lint` and `pnpm build` (including `synth` and `checkov`); confirm the invariant list in `invariants.ts` matches the docs the e2e README mentions, and that no TODO or skipped test was added. Update `CLAUDE.md`'s architecture notes with one sentence on certificates (issued in the progress recalculation, public `certificate.verify`).
- [ ] T024 (human) Reviewer follows [quickstart.md](./quickstart.md) "By hand" on a local stack: complete a course as a student, download the PDF and look at it (layout, one page, long names, an accented name), open the shared link in a private window, toggle the setting; save screenshots of each key step, including any failure, to `tmp/screenshots/pr-<number>/`.
- [ ] T025 (human) After deploying to `discava-development`, check that signed-out `certificate.verify` works through API Gateway (no authorizer 401), that the PDF's verification URL shows the real portal origin, and that completing a course issues one certificate through the real stream and Lambda.

---

## Dependencies and order

- PR 1 (T001 to T004) blocks everything.
- PR 2 (T005 to T008) and PR 3 (T009 to T012) and PR 4 (T013 to T015) each depend only on PR 1 and may be written in parallel by separate agents; merge in numeric order.
- PR 5 (T016 to T018) needs PR 3. PR 6 (T019 to T025) needs PRs 2 to 5.
- Within a phase, tests come first, and tasks run in ID order except those marked [P].

## Implementation strategy

MVP is PRs 1 to 3 plus the My Learning half of PR 5 (a certificate is issued, verifiable and downloadable). PR 4 adds the instructor switch (until then every course issues, which is the default). PR 6 closes the issue. Each PR runs `pnpm nx affected --target build` before it is opened and stays within its phase's files.
