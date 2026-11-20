# Implementation Plan: Free Preview Lessons

**Branch**: `20261120-154626-free-preview-lessons` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261120-154626-free-preview-lessons/spec.md`

## Summary

A lesson gains an optional `freePreview` mark, set by instructor-api's new `lesson.setFreePreview` and refused for assignment lessons. One function in `core-table`, `isOpenFreePreview`, decides whether a marked lesson is open: course published, module and lesson shown, lesson of kind `lesson`.

core-api gets a new public router, `freePreview`, with three queries and nothing else:

- `freePreview.lesson` returns an open preview lesson's shown items, reduced to what a visitor may see (text bodies, file names, video titles, a locked quiz card);
- `freePreview.videoUrl` signs playback for one video item of an open preview lesson, with cookies scoped to that version's folder and a one-hour life;
- `freePreview.fileUrl` signs a five-minute download link for one file item of an open preview lesson.

The two signing queries join `course.previewVideoUrl` on the existing `MediaUrl` function, the only core-api holder of the CloudFront signing key. All three join `PUBLIC_OPERATIONS`.

The existing student procedures do not change. `requireEnrolment` and every procedure behind it refuse a caller without an enrolment exactly as today, for marked lessons too. The exception to "unpaid users cannot get paid content" is therefore three named operations and one predicate, and the existing tests of the rule are added to, not loosened.

The student portal's landing page labels and links open preview lessons, and a new public route, `/learn/$courseId/preview/$lessonId`, shows one. The instructor portal gets a Free preview control and badge on each ordinary lesson. The page renderer's outline gains the label and link; the preview address itself already falls under the renderer's "signed-in learning routes" rule (plain `index.html`, `noindex`) and the robots file's `Disallow: /learn/*/`.

No new entity, index, table, function, stack, secret or stage setting.

What the code showed that the issue could not:

1. **An operation is either behind the Cognito authorizer or not.** API Gateway skips the authorizer for the operations in `PUBLIC_OPERATIONS` (`packages/apis/core-api/src/router.ts`), and a skipped authorizer means no `ctx.user` on a deployed stage, signed in or not. `contentItem.videoUrl` and `contentItem.fileUrl` are `courseProcedure`s that need `ctx.user.sub` for the enrolment check and the saved video position. They cannot be made to "allow a preview lesson's media without an enrolment", as the issue proposes, without either losing the user for enrolled students or keeping signed-out visitors out. The preview needs operations of its own (research R-2).
2. **The precedent exists.** `course.previewVideoUrl` (`procedures/course.ts`) is a public query on the `MediaUrl` function that signs cookies for one folder (`getSignedCloudFrontCookies(prefixKey)`, with `Path=/<prefixKey>`), so the promo video opens no lesson video. A preview lesson's video is signed the same way.
3. **Signing is all or nothing in time.** `getSignedCloudFrontCookies` always uses `SIGNED_COOKIE_LIFETIME_SECONDS` (four hours), and a signed cookie cannot be revoked. "Removes public access at once" therefore means: no new signature after the change, and a shorter life for the ones already out (research R-5).
4. **Local dev does not sign.** With `LOCAL_DEV=true` media is served straight from S3Mock (`lesson-media.ts`), so the scope and life of a signature can only be unit-tested against the policy the signer builds, and checked for real on a deployed stage by a reviewer.
5. **Visibility is already one function.** `isShown` and `filterEffectivelyVisible` (`core-table/src/helpers/curriculum.ts`) are what `course.publicView`, `course.view`, `contentItem.videoUrl` and `quiz.view` use. The preview rule is built from them, not beside them.
6. **`course.publicView` already filters to visible lessons of a published course** and spreads the lesson record through `PublicLessonSchema`. Adding `freePreview` to that schema is what labels the outline, in the portal and in the page renderer, which renders from the same output.
7. **Lesson writes live in instructor-api** (`procedures/lesson.ts`), conditioned in one transaction on the lesson not being archived and its ancestors being active (`writeUnderActiveAncestors`). The mark is one more such write. `kind` is set at creation and never changes, so "only ordinary lessons are marked" needs a condition on the write and nothing after it.
8. **Every curriculum MODIFY reaches the progress recalculation** (`PROGRESS_STREAM_FILTERS`). A mark change is a lesson MODIFY, so it triggers a recalculation that reads nothing the mark affects. No other stream feature lists `lesson`.
9. **The landing page's buy and enrol actions are one component**, `EnrolmentActions` (`student-portal/src/routes/learn/$courseId/-components/enrolment-actions.tsx`), and the checkout returns to `/learn/<courseId>?checkout=success`. The preview page mounts that component unchanged in behaviour; a purchase started there returns to the landing page as the checkout spec defines.

## Technical Context

**Language/Version**: TypeScript (Node Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC + zod, ElectroDB (`@discava/core-table`), `@aws-sdk/cloudfront-signer` through `@discava/common-server-utils/lesson-media`, TanStack Router/Query, `@discava/common-shadcn` (`HlsVideo`), `@discava/common-tiptap`. No new dependency

**Storage**: the one core table. `lesson` gains one optional attribute, `freePreview`. No new entity or index

**Testing**: vitest per project, `core-table`'s `helpers/invariants/`, portal component tests, Playwright e2e in `packages/e2e`, CDK assertion tests in `common-constructs` and `infra`

**Target Platform**: AWS Lambda + API Gateway + CloudFront; `pnpm dev` with Docker locally

**Project Type**: web application: serverless backend + React portals

**Performance Goals**: a preview lesson loads with four keyed reads and one keyed query; a video starts within 5 s of pressing play (one signing call, as for the promo video)

**Constraints**: no change to `requireEnrolment` or any procedure behind it; no storage key, quiz question or answer in a public response; no write of any kind on the preview path; no scan; no signature longer than an enrolled student's; stacks under 500 resources

**Scale/Scope**: one attribute, one instructor mutation, three public queries, one portal route, one editor control, one renderer change

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | Lambda, API Gateway, DynamoDB, CloudFront signing as today. Nothing new |
| II. Generators first | Pass | No project, API, function or construct is scaffolded. Procedures, a schema file, a portal route and components are hand-added to existing packages, as every procedure and route is |
| III. Everything runs locally | Pass | The whole flow runs under `pnpm dev`. Documented exception, already the repo's: CloudFront signing and cookies only run on a deployed stage, so the signature's scope and life are unit-tested and then checked on `discava-development` by a reviewer (T042) |
| IV. Layered tests | Pass, planned | Unit tests for the predicate, the mutation and the three queries, including a refusal matrix; a new invariant with breaking tests; component tests in both portals; an e2e scenario that also attacks the preview route. Impact check below |
| V. Single-table via ElectroDB | Pass | One optional attribute on `lesson`. Access patterns in [data-model.md](./data-model.md): keyed gets and one keyed query on the primary index; no scan, no new index. Stream features considered below |
| VI. Secure by default | Pass | The new operations get the stage's WAF and public throttle by being listed in `PUBLIC_OPERATIONS`, like the other public operations. Signatures are narrower in time than today's (one hour against four). No stage setting is added or relaxed |
| VII. Change freely before launch | Pass | The attribute is added outright. It is optional by meaning (absent: not marked), as `archivedAt` is, so there is no fallback and no backfill. No redirect for a preview address that stops working |
| VIII. Repo conventions | Pass | `core-table/src/helpers/curriculum.ts` for the rule; `core-api/src/helpers/free-preview.ts`; kebab-case files; route-private portal components in `-components/`; text-only buttons; docs in English with translations noted |

No violations, so Complexity Tracking is empty.

**Impact check (constitution IV).** Shared records the feature writes or reads in a new way:

| Record | Use | Existing invariants and tests that already cover it | What changes |
|--------|-----|------------------------------------------------------|--------------|
| `lesson` | Written: `freePreview`, only by instructor-api's `lesson.setFreePreview` (the file that already writes lessons). Read in a new way: by anonymous callers, through `isOpenFreePreview` | `curriculum-has-parents`, `sibling-order-unique`, `child-order-claimed`, `assignment-lesson-shape`, `published-at-set`, `draft-course-nothing-archived` | None of them reads the mark. New check `free-preview-on-ordinary-lesson`: a lesson that carries `freePreview` has the value `true` and `kind` `lesson` (T004). `entity-writers.json` is regenerated; no new writing package or file |
| `course`, `module` | Read: `status`, `visibility`, `archivedAt`, by anonymous callers on the preview path | `published-at-set`, `draft-course-nothing-archived`, `price-shape` | None. Not written |
| `contentItem` | Read by anonymous callers: the shown items of an open preview lesson; `s3Key`, `previousS3Key` and `captionTracks` are read to sign and never returned | `media.ts` checks, `curriculum-has-parents`, `activity-count-matches-students` | None. Not written. `studentActivityCount` is untouched because a preview is not student activity (T016 asserts no write) |
| `enrolment`, `order` | Not read on the preview path, not written. The portal reads `course.myEnrolment` for a signed-in visitor, as the landing page does | `paid-course-enrolment-paid`, `paid-order-has-enrolment`, `enrolment-order-matches`, `enrolment-in-published-course` | No rule changes: a preview creates no enrolment, so "an enrolment in a priced course rests on a paid order" holds as written. The check's comment and the design docs name open preview lessons as the one way content is read without an enrolment (T005, T039) |
| `itemCompletion`, `progress`, `videoPosition`, `quizAttempt`, `quizSummary`, discussion and assignment records | Not read, not written | `student-records-enrolled`, `student-records-have-targets`, `progress-matches-completions`, `video-position-valid` | None. `student-records-enrolled` is the data form of "a preview records nothing": any record written for a visitor would break it. The e2e scenario runs the invariants after a signed-in, not enrolled visitor watched a preview (T035) |
| `paid-access.test.ts` (core-api) | The API form of "unpaid users cannot get paid content" | Its table of content procedures refused without an enrolment | **Extended, not loosened** (T015): the same table is run again against a marked, open preview lesson and must refuse identically; `contentItem.saveVideoPosition`, `quiz.myAttempts`, `course.myLessonProgress` and `announcement.list` join the table if absent |
| Stream consumers | A mark change is a `lesson` MODIFY. It matches `progress-recalculation` (every curriculum MODIFY does), which recomputes the same figures. It matches no entry of `search-indexing`, `analytics-update`, `notification-delivery` or `earnings-recording` | `progress-stream.test.ts`, `stream-features.test.ts` | One assertion added (T006): a `lesson` MODIFY that changes only `freePreview` matches `progress-recalculation` and no other registration. No filter changes |

## Design Decisions (detail in [research.md](./research.md))

1. **The mark lives on the lesson**, as an optional attribute stored only as `true`. Assignment lessons are refused by a condition on the write (R-1).
2. **Three new public queries; the enrolled procedures are untouched** (R-2). The exception is a named list, `freePreview.*`, not a branch inside `requireEnrolment`.
3. **One rule, one loader.** `isOpenFreePreview` in `core-table` decides; `loadOpenFreePreview` in core-api reads the course, module and lesson and throws one `NOT_FOUND` for every reason a lesson is not open. All three queries start with it (R-3).
4. **The public view is built by picking, never by spreading.** Each item type has a schema that lists the fields a visitor gets; a quiz is a locked card; any other type is dropped (R-4).
5. **Signatures: one video version's folder for one hour, one file for five minutes**, renewed by the page while it is open; nothing is revoked (R-5).
6. **Unmarking closes the route on the next request.** Nothing in front of the three queries caches. Old addresses show "no longer available" (R-6).
7. **A preview writes nothing and asks nothing of the caller's identity** (R-7).
8. **Abuse and cost are handled by what the public operations already have**: WAF where the stage enables it, the public throttle, sign-on-play, CORS on the media distribution. No per-visitor limit and no quota are added (R-8).
9. **The paid-content rule is restated in three places**: the data check (unchanged, comment updated), the API test (extended to marked lessons), and a new refusal matrix for the preview route (R-9).
10. **Crawlers get the label, not the lesson** (R-10).
11. **A separate portal route**, `/learn/$courseId/preview/$lessonId`, public, with the landing page's own enrol and buy actions; an enrolled student is sent to the normal lesson page (R-11).
12. **Quizzes and in-video questions are locked in a preview** (R-12).

## Project Structure

### Documentation (this feature)

```text
specs/20261120-154626-free-preview-lessons/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── core-api-free-preview.md
│   ├── instructor-api-lesson.md
│   ├── portal-ui.md
│   └── page-renderer.md
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/
├── databases/core-table/src/
│   ├── entities/lesson.ts                         # + freePreview (optional boolean, stored only as true)
│   ├── helpers/curriculum.ts                      # + isOpenFreePreview (+ test)
│   ├── helpers/invariants/curriculum.ts           # + free-preview-on-ordinary-lesson (+ test)
│   ├── helpers/invariants/payments.ts             # comment on paid-course-enrolment-paid names the exception
│   └── helpers/stream-features.test.ts            # a freePreview-only lesson MODIFY: progress-recalculation only
├── common/
│   ├── server-utils/src/media-keys.ts             # + FREE_PREVIEW_COOKIE_LIFETIME_SECONDS (1 hour)
│   ├── server-utils/src/lesson-media.ts           # getSignedCloudFrontCookies takes an optional lifetime (+ test)
│   └── constructs/src/app/apis/core-api.ts        # MediaUrl gains freePreview.videoUrl and freePreview.fileUrl (+ test)
├── apis/
│   ├── instructor-api/src/
│   │   ├── procedures/lesson.ts                   # + setFreePreview (+ test)
│   │   ├── schema/lesson.ts                       # LessonSchema + freePreview; SetFreePreview input and output
│   │   └── router.ts                              # lesson.setFreePreview
│   └── core-api/src/
│       ├── helpers/free-preview.ts                # loadOpenFreePreview, asPreviewItem (+ test)
│       ├── procedures/free-preview.ts             # lesson, videoUrl, fileUrl (+ test: the refusal matrix)
│       ├── procedures/paid-access.test.ts         # extended to a marked lesson
│       ├── procedures/course.ts                   # publicView: lessons carry freePreview
│       ├── schema/free-preview.ts, schema/course.ts
│       ├── router.ts                              # freePreview router; PUBLIC_OPERATIONS (+ router.test.ts)
│       └── page-renderer/render-course.ts         # outline label and link (+ render.test.ts, handler.test.ts)
├── websites/
│   ├── student-portal/src/routes/learn/$courseId/
│   │   ├── preview/$lessonId.tsx                  # new public route
│   │   ├── -components/free-preview-page.tsx      # the page (+ test)
│   │   ├── -components/free-preview-item.tsx      # video (sign on play), text, file, locked quiz (+ test)
│   │   ├── -components/course-page.tsx            # outline label and link
│   │   └── -components/enrolment-actions.tsx      # optional continueTo for the enrolled dialog
│   └── instructor-portal/src/routes/_authenticated/my-courses_/$courseId/-components/
│       ├── lesson/free-preview-button.tsx         # control with confirmation (+ test)
│       ├── lesson/free-preview-badge.tsx
│       └── course/course-modules.tsx              # mounts both beside the visibility button
├── e2e/src/
│   ├── scenarios/free-preview.e2e.ts
│   └── helpers/free-preview.ts
docs/src/content/docs/en/
├── design/public-pages.mdx                        # "Free preview lessons" section, "Spec" link
└── guides/instructor-guide.mdx                    # marking a lesson
```

**Structure Decision**: extend existing packages only. The rule that decides what is open is read by core-api's procedures and by its page renderer through `course.publicView`, and is the thing the invariant describes, so it lives in `core-table` beside `isShown`. The loader and the item reduction are used only by core-api, so they stay in its `helpers/` (constitution VIII). The preview page is route-private to the student portal.

## Risks

- **R1: a field leaks through a spread.** `course.view` builds its output by spreading records through a zod schema, which is safe only while the schema is strict about what it lists. The preview's item schemas are separate, list every field, and the procedure builds each item by picking. A test feeds a record that carries every sensitive attribute (`s3Key`, `previousS3Key`, `captionTracks`, `answerKey`, `questions`, `settings`, `mediaConvertJobId`, `rawObjectETag`, `submissionNonce`, an assignment `body`) and asserts none appears in the serialised response (T016).
- **R2: an item addressed under the wrong lesson.** The item is read with the full key (`courseId`, `moduleId`, `lessonId`, `contentItemId`), so an item of another lesson is simply not found under the preview lesson's address. A test pins it, because a future change to a query by `contentItemId` alone would open every video of the course (T016).
- **R3: signatures cannot be checked locally.** The scope and the life are asserted on the policy the signer builds (unit), and a reviewer confirms on `discava-development` that preview cookies do not fetch another video's manifest and stop working after an hour (T042).
- **R4: a long video outlives its cookie.** The page refetches `freePreview.videoUrl` every 30 minutes while open, in the background too; the response is the same address with fresh cookies, so the player is not restarted. A component test pins the interval and that an unchanged address does not remount the player (T024).
- **R5: the landing page is cached at the edge for 5 minutes.** After an unmarking, a cached page can still show the label. Its link reaches a page that asks core-api, which refuses. No content is served from the cached page, because the outline holds titles only.
- **R6: instructors open more than they meant to.** Marking is one click on a real, paid lesson. The confirmation names the consequence, the badge is always visible in the editor, and unmarking is immediate. No quota is added (R-8).
- **R7: bandwidth.** Anyone can stream a preview video, and the platform pays for the delivery. The public throttle limits how often a signature is issued, not how many bytes one signature streams. This is the same exposure the promo video has; the docs tell an operator where to look (T039). A per-visitor or per-course cap is a follow-up.
- **R8: the in-video questions spec (#591) lands later.** Its player must not ask questions in a preview. The preview's video component does not use the lesson player's `VideoPlayer`, and `freePreview.videoUrl`'s output schema is its own, so nothing #591 adds to `contentItem.videoUrl` reaches a visitor by default. The contract says so, for that spec to link to.
- **R9: `PublicLessonSchema` is shared.** It is `LessonSchema.omit({ contentItems })`. The mark is added to the public schema only, by `extend`, so `course.view`'s output for enrolled students does not change and its snapshot tests stay as they are.

## Constitution re-check after design

All eight principles still pass. I: nothing new is deployed beyond two operations on an existing function and one on the shared router. II: nothing is scaffolded. III: every step runs under `pnpm dev`; the signing exception is the repo's existing one. IV: the predicate, mutation, queries, portals and renderer each have tests first; one invariant is added with breaking tests; `paid-access.test.ts` is extended; an e2e scenario covers the flow and the attacks. V: one optional attribute; reads are keyed; no scan and no index. VI: public operations inherit WAF and throttling; signatures are shorter than today's. VII: no fallback, no backfill, no redirect. VIII: files and helpers follow the layout above.

## Complexity Tracking

*No constitution violations.*
