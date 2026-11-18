---

description: "Task list for catalogue categories, tags and richer filters"
---

# Tasks: Catalogue Categories, Tags and Richer Filters

**Input**: Design documents from `/specs/20261115-000000-catalogue-categories/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires them, so they are included: unit tests for each procedure and helper, invariant checks with tests that break them for the rules that span records, an extended `packages/e2e` search scenario for facet counts, a category scenario, and a concurrency test for same-name category creation. Write each story's tests first and see them fail. Never weaken an existing test to make it pass (constitution IV).

**Who runs what**: an automated agent implements these tasks without `pnpm dev` or Docker. It runs unit and component tests, lint, typecheck, `build` and `synth` locally. The e2e scenarios and the concurrency test are written by the agent but run on PR CI (`pr-checks.yml`'s `E2E tests` job, which runs `nx affected --target e2e`); a CI failure is the feedback for those. Tasks marked **(human)** need a running local stack or people, and are done by a reviewer before merging.

**Organization**: Grouped by user story so each can be built and tested on its own. Paths are relative to the repository root.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 facets and filters (P1), US2 instructor sets fields (P1), US3 admin taxonomy (P2), US4 landing pages (P2), US5 re-index (P3)

---

## Phase 1: Setup

- [x] T001 Read the `nx-plugin-for-aws` MCP guidance (`general-guidance`, `list-generators`, `generator-guide` for `ts#trpc-api` and `connection`) and record in the PR description which generators this feature uses (only `admin-api`, in US3) and why entities and the search changes are hand-written. No file changes.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the records, the shared write helpers and invariants, the course attributes and the additive search fields that every story reads or writes.

**⚠️ CRITICAL**: no user story work starts until this phase is done.

### Records and shared write helpers (constitution IV, V; impact check in plan.md)

- [x] T002 Test first, then add the `category` entity in `packages/databases/core-table/src/entities/category.ts` and the `categoryClaim` entity in `packages/databases/core-table/src/entities/category-claim.ts`, register both in `src/entities/index.ts` and `src/service.ts`, per [data-model.md](./data-model.md): `category` has pk fixed `category`, sk `categoryId` (UUIDv7), `name` (required, "1 to 60 characters"), `slug` (required, "unique, immutable, URL-safe (`a-z`, `0-9`, `-`)"), `status` (`active` or `archived`, default `active`), `createdAt`, `updatedAt`; `categoryClaim` has pk fixed `categoryClaim`, sk `slug#<slug>` or `name#<normalised name>`, and `categoryId`. No new index. Entity tests (beside `assignment-submission.test.ts`'s pattern) refuse a record missing a required attribute and a status outside the two values.
- [x] T003 Add the five optional attributes to `packages/databases/core-table/src/entities/course.ts` exactly per data-model: `categoryId`, `tags` (list of strings), `level` (`beginner`, `intermediate` or `advanced`), `language` (a code from the fixed list: en, es, fr, de, pt, zh, ja, hi, ar; export the list and a `LANGUAGES` type from a new `packages/databases/core-table/src/helpers/catalogue.ts`), `durationHours` (number). No key or index change.
- [x] T004 [P] Test first, then implement `normaliseTags` and `normaliseCategoryName` and `categorySlug` in `packages/databases/core-table/src/helpers/catalogue.ts`: tags trimmed, inner spaces collapsed, lower-cased, de-duplicated, "1 to 30 characters", "at most 8" (an over-limit input is an error, not truncated); names trimmed and collapsed, "1 to 60 characters", compared case-insensitively; slug derived from the name (lower case, accents folded, non-alphanumerics to `-`, no leading, trailing or repeated `-`) and an error when nothing URL-safe remains. Tests in `helpers/catalogue.test.ts`: " Data  Science " gives "data science"; duplicates collapse; 31-character and empty tags refused; a ninth tag refused; "Café & Bar" slugs to `cafe-bar`; a name of only symbols refused.
- [x] T005 Test first, then implement `categoryWrites` in `packages/databases/core-table/src/helpers/category.ts` (exported from `src/index.ts`): `create` (category + slug claim + name claim in one transaction, each condition "not exists"; on a cancelled transaction read the cancellation reasons by item position: a failed slug claim (another category has the slug) retries with the next numeric suffix, re-reading the slug claims each time, at most 5 attempts, then a typed error; a failed name claim is the typed name-conflict error (`CONFLICT`), checked first when both fail; two concurrent creates that pick the same suffix both write the same slug claim, so one wins and the other is cancelled on the slug claim, re-reads and takes the next suffix, or gets `CONFLICT` if its name was also the winner's; so two names that slug alike both succeed), `rename` (when the normalised new name equals the current one, as in "science" to "Science" or "Data  Science" to "Data Science", only patch `name`: no claim is created or deleted, because DynamoDB rejects two operations on one item in a transaction; otherwise patch name, create new name claim, condition not exists; delete the old name claim; slug and slug claim untouched), `archive` (patch status, condition `active`). Name conflicts surface as a typed error from `helpers/errors.ts`. Tests in `helpers/category.test.ts`: create writes all three records; a duplicate name ignoring case and spacing is refused; two creates of the same name at once yield one success (transaction cancellation); with a mocked cancelled transaction for each, a slug-claim failure retries with the suffix (giving `science-2`) and a name-claim failure is `CONFLICT`; two creates of different names with one slug at once both succeed, with distinct slugs and one claim of each kind each; an exhausted retry limit gives the typed error; a case-only or spacing-only rename succeeds, changes `name`, and leaves both claims as they were; rename keeps the slug and moves the name claim; renaming to a taken name is refused; archive of an archived category is a no-op; a category's slug is never changed by any call.
- [x] T006 Test first, then implement `courseCatalogueWrites` in `packages/databases/core-table/src/helpers/course-catalogue.ts` (exported from `src/index.ts`): normalises with T004, validates level, language and "durationHours" as "a whole number 1 to 500", and patches the course with replace semantics (an omitted field is removed) with a condition that the category exists and is active, or equals the course's current `categoryId` (research R-6). Tests: sets and clears every field; an archived or missing category is refused; keeping an archived current category is allowed; an out-of-range duration, unknown level or language refused.
- [x] T007 Add `categories` and `categoryClaims` to `TableSnapshot` and load them in the snapshot scan in `packages/databases/core-table/src/helpers/invariants.ts`; confirm `packages/e2e/src/helpers/table-invariants.ts` runs the same checks without change, and edit it only if it builds its own snapshot. Add the new invariant names to the invariant-name list in that file.
- [x] T008 Add and register `checkCourseCategoryExists` (`course-category-exists`), `checkCategoryClaimsConsistent` (`category-claims-consistent`) and `checkCourseCatalogueShape` (`course-catalogue-shape`) in `packages/databases/core-table/src/helpers/invariants.ts`, with the rules exactly as in data-model's Invariants. A breaking test for each rule in `invariants.test.ts`: a course whose `categoryId` has no category; a category missing its slug claim, one missing its name claim, a claim pointing to no category, a claim whose slug or name differs from its category's; a course with an unnormalised, duplicate or nine-tag list, a bad level, a duration of 0 and one of 501. Plus one that a course with none of the fields is NOT a violation.
- [x] T009 [P] In `packages/databases/core-table/src/helpers/search-stream.test.ts` assert that a `category` or `categoryClaim` record change does not match `SEARCH_STREAM_FILTERS`, and in `progress-stream.test.ts` that it does not match `PROGRESS_STREAM_FILTERS`; a course MODIFY that changes only a catalogue field still matches the search filters. Change the filters only if a test shows they are wrong.

### Additive search fields (research R-2; #270)

- [x] T010 Test first, then extend `CourseDocumentSchema` and the `courses` mapping in `packages/databases/search/src/indices/courses.ts` with `categoryId`, `level`, `language` and `tags` as `keyword` and `durationHours` as `integer` (all optional in the schema; `tags` an array of strings). Add a test in `packages/databases/search/src/index-sync/sync-indices.test.ts` (or a new `courses.test.ts`) that every property of the previous mapping is unchanged (type and analyzer) and the new ones are only additions, so `putMapping` applies in place; note in a comment that a breaking change needs #270.
- [x] T011 Extend `CourseSource` and `toCourseDocument` in `packages/events/src/search/course-document.ts` to carry the five fields (the one builder both the stream indexer and `search-reindex.ts` use); extend `course-document.test.ts`, `index-content.test.ts` and `search-reindex.test.ts` (add cases, change no existing assertion): a course with all fields indexes them, a course without them indexes none, and the re-index writes the same document the stream indexer does.

**Checkpoint**: records, helpers and invariants exist, course documents carry the new fields. No API or portal change yet.

---

## Phase 3: User Story 1 - Filter and browse the catalogue with facets (Priority: P1) 🎯 MVP

**Goal**: a visitor narrows the catalogue by category, tags, level, language and duration and sees correct counts; filters live in the address.

**Independent Test**: with published courses that differ in every field, apply one filter and then several, and check results and every facet count against the courses.

### Tests for User Story 1 (write first, see them fail)

- [x] T012 [P] [US1] Unit tests for the query builder `buildSearchRequest` in `packages/apis/core-api/src/helpers/search-query.test.ts`: no `q` gives `match_all` filtered to published and sorted by `publishedAt` desc then `courseId`; with `q` the existing `cross_fields` query; every filter lands in `post_filter` (OR inside a facet via `terms`, AND across facets); each facet aggregation applies every filter except its own; duration bands `lt2`, `2to10`, `10to40`, `gt40` map to "under 2, 2 to 10, over 10 to 40, over 40" hours without gaps or overlaps (1, 2, 10, 11, 40, 41 each fall in exactly one); tags aggregate with size 20 and the category aggregation is sized to 500, not 20.
- [x] T013 [P] [US1] Extend `packages/apis/core-api/src/procedures/search.test.ts` and add `category.test.ts` beside it (follow `packages/apis/instructor-api/src/procedures/course.test.ts`, `t.createCallerFactory`, `vi.mock`, and the `resolve.alias` for `@discava/core-table` in `vitest.config.mts`): facet buckets map to `{ id, name, slug, count }` using the category list; archived categories are dropped from the category facet; selected values are listed even with a zero count; unknown filter values return no items and no error; `q` optional; the cold-start `TIMEOUT` is kept; `category.list` returns active categories with `courseCount` (including zero) sorted by name; `category.bySlug` returns an archived category with its status and `NOT_FOUND` for an unknown slug; both are anonymous-callable and `router.test.ts`'s check of `PUBLIC_OPERATIONS` passes.
- [x] T014 [P] [US1] Component tests in `packages/websites/student-portal/src/routes/search/-search.test.tsx`, `packages/websites/student-portal/src/routes/-routes.test.tsx` and a new `packages/websites/student-portal/src/components/catalogue-filters.test.tsx`, per [contracts/portal-ui.md](./contracts/portal-ui.md): groups and counts render; selecting and clearing values updates the address; the address restores filters on load; empty state with a "Clear filters" button; browse with filters and no text; unknown values show the empty state; the home chips come from `category.list`. Plus `catalogue-filters.test.ts` for the parser in `src/lib/catalogue-filters.ts` (round trip, unknown parameters ignored).
- [x] T015 [US1] Extend `packages/e2e/src/scenarios/search.e2e.ts` and add helpers in `packages/e2e/src/helpers/` for creating categories (through core-table's `categoryWrites`) and setting course catalogue fields (through the table helper `courseCatalogueWrites` until US2's procedure exists): publish several courses with uniquely named data and differing fields, then assert every facet count for no filter, each single filter, two values in one facet, two facets together and a text query plus a filter, each against a hand count; assert a draft and an archived course are in no count. Own users and data, no local data reset, the table-invariants fixture runs after each test. Facet counts here are the issue's acceptance criterion.

### Implementation for User Story 1

- [x] T016 [US1] Schemas in `packages/apis/core-api/src/schema/search.ts` and new `schema/category.ts` (exported from `schema/index.ts`) per [contracts/core-api-catalogue.md](./contracts/core-api-catalogue.md): extend `SearchCoursesInputSchema` (`q` optional "1 to 200 characters when present", `categoryId`, `tags` at most 8, `levels`, `languages`, `durationBands`, `cursor`, `limit` "integer <= 50") and the hit and output schemas with `category`, `tags`, `level`, `language`, `durationHours` and `facets`; category list and by-slug schemas.
- [x] T017 [US1] Implement `buildSearchRequest` in `packages/apis/core-api/src/helpers/search-query.ts` (query, `post_filter`, per-facet `filter` aggregations as in research R-3) until T012 passes.
- [x] T018 [US1] Change `course.publicSearch` in `packages/apis/core-api/src/procedures/search.ts` to use it, read the category list from the core table (use `publicCourseProcedure`'s core-table plugin together with the search plugin: build a `publicSearchProcedure` in `init.ts` if none exists), map buckets to names and drop archived categories from the facet, keep the 8 s request timeout and the `TIMEOUT` mapping. Add `procedures/category.ts` with `category.list` (one size-0 `terms` aggregation sized to 500 for counts; a unit test with 25 categories, some with zero courses, expects all 25 listed with their counts, and the aggregation size in the request is 500) and `category.bySlug`; register both in `router.ts` and in `PUBLIC_OPERATIONS`.
- [x] T019 [US1] Run `pnpm nx run @discava/core-api:test -- --run` plus lint and typecheck; confirm no unit test other than the extended ones changed. Update the API Gateway integration lists or operation maps that pin public operations if `router.test.ts` or the construct tests name them (`packages/common/constructs/src/app/apis/core-api.ts`).
- [x] T020 [US1] Student portal: `src/lib/catalogue-filters.ts` (filter state to and from search params), `src/components/catalogue-filters.tsx` (the filter panel, text buttons only), wire it into `src/routes/-components/catalogue.tsx` (category chips from `category.list`, results from `course.publicSearch`) and `src/routes/search/index.tsx` (browse with filters and no text; the box still requires text); update `components/course-card.tsx` and delete the mock categories, levels and durations from `src/lib/course-display.ts` (FR-019), keeping what the card still needs.
- [x] T021 [US1] Run the US1 unit and component tests (`pnpm nx run-many --target test`, run once) plus lint and typecheck locally and fix until green. The US1 e2e scenario (T015) runs on PR CI; read its result and fix any failure, including the invariant check.

**Checkpoint**: the catalogue filters with correct facets (courses populated by seed helpers for now); the MVP is usable on its own.

---

## Phase 4: User Story 2 - Instructor describes the course (Priority: P1)

**Goal**: an instructor sets, changes and clears category, tags, level, language and duration; the search entry follows.

**Independent Test**: set all five fields on a course, publish, check it under the matching facet values; change them and check it moves.

### Tests for User Story 2 (write first)

- [x] T022 [P] [US2] Unit tests in `packages/apis/instructor-api/src/procedures/course-catalogue.test.ts` for `course.updateCatalogue` and `category.listActive` per [contracts/instructor-api-course-catalogue.md](./contracts/instructor-api-course-catalogue.md): only an instructor of the course (others `FORBIDDEN`); sets and clears each field (an omitted field is cleared); " Data  Science " stored as "data science"; a ninth tag, a 31-character tag, duration 0 and 501, unknown level and language, an unknown or archived category each `BAD_REQUEST`; keeping an archived current category succeeds; `listActive` returns only active categories.
- [x] T023 [P] [US2] Component tests in `packages/websites/instructor-portal/src/routes/_authenticated/` (beside the course page's existing tests) for the "Catalogue details" form per [contracts/portal-ui.md](./contracts/portal-ui.md): tag chips add on Enter or comma and remove, the 8-tag limit message, an archived current category shown as "<name> (archived)" and selectable, API validation messages, clearing a field.
- [x] T024 [US2] Extend `packages/e2e/src/scenarios/search.e2e.ts` (or add `catalogue-fields.e2e.ts`): as an instructor set the five fields through the portal, publish, find the course under the facet values as a visitor, change the category and see it move within a minute (poll), a student cannot call the procedure. Switch T015's setup helper to the instructor-api procedure where practical.

### Implementation for User Story 2

- [x] T025 [US2] Extend `CourseSchema` in `packages/apis/instructor-api/src/schema/course.ts` with `categoryId?`, `tags`, `level?`, `language?`, `durationHours?`; add `schema/course-catalogue.ts` for the input.
- [x] T026 [US2] `course.updateCatalogue` and `category.listActive` in `packages/apis/instructor-api/src/procedures/course-catalogue.ts`, built on `courseProcedure` and `courseCatalogueWrites`, registered in `router.ts`; map helper errors to `BAD_REQUEST`, `NOT_FOUND`, `FORBIDDEN`.
- [x] T027 [US2] Instructor portal "Catalogue details" form (category select, tags input, level, language, duration) on the course page under `packages/websites/instructor-portal/src/routes/_authenticated/`, calling `course.updateCatalogue`; text buttons only.
- [x] T028 [US2] Run the US2 unit and component tests locally and fix until green. The e2e scenario runs on PR CI.

**Checkpoint**: US1 and US2 work together; courses can be described and found by facet.

---

## Phase 5: User Story 3 - Admin manages the category taxonomy (Priority: P2)

**Goal**: an admin creates, renames and archives categories in the admin portal; instructors choose from the active ones.

**Independent Test**: as an admin create a category and see it offered to instructors; rename it and see the new name on courses and facets; archive it and see it no longer offered.

### Tests for User Story 3 (write first)

- [x] T029 [P] [US3] Unit tests in `packages/apis/admin-api/src/procedures/category.test.ts` (after T031) per [contracts/admin-api-category.md](./contracts/admin-api-category.md): every procedure is `FORBIDDEN` for a caller outside the `admin` group; `create` returns the category with a slug; a duplicate name ignoring case is `CONFLICT`; an empty, 61-character or symbol-only name is `BAD_REQUEST`; `rename` keeps the slug, `NOT_FOUND` for an unknown id, `CONFLICT` on a taken name; `archive` is idempotent; `list` includes archived categories with `courseCount` over every course status.
- [x] T030 [P] [US3] Component tests for the "Categories" screen in `packages/websites/admin-portal/src/routes/categories/` (table, add, inline rename, archive confirmation, duplicate-name error); a concurrency test in `packages/e2e/src/concurrency/` (beside `concurrent-writes.e2e.ts`, same `race` helper and fixture): several creates of one name at once leave exactly one category and one name claim, the rest `CONFLICT`; several creates of different names that slug alike (for example "Data Science" and "Data-Science") at once all succeed with distinct slugs (`data-science`, `data-science-2`, ...), one slug claim and one name claim each; and `packages/e2e/src/scenarios/category.e2e.ts`: as Carol create, rename and archive a category, see an instructor offered only active ones, and a non-admin refused.

### Implementation for User Story 3

- [x] T031 [US3] Scaffold `admin-api` with the `ts#trpc-api` generator (project `@discava/admin-api` under `packages/apis/admin-api`, following the guide read in T001) and connect `packages/websites/admin-portal` to it with the `connection` generator; review the output (R5) and commit it as generated. Add the stack to `packages/infra/src/stages/application-stage.ts` as `AdminApi` (update the stage's doc comment on dependency order) reading from `Data` only, and CORS/Cognito wiring like InstructorApi, including the admin portal's `runtime-config.json` entry for the API in the `RuntimeConfig` stack and `restrictCorsTo` for the admin portal's origin. Add `electrodb` and `@aws-sdk/client-dynamodb` as direct dependencies (CLAUDE.md's TS2883 note) and the `@discava/core-table` alias in its `vitest.config.mts`.
- [x] T032 [US3] In `packages/apis/admin-api/src`: a `protectedProcedure` that requires the `admin` Cognito group and throws `FORBIDDEN` otherwise (as instructor-api does for `instructor`), a hand-written `courseProcedure`-style core-table plugin (see `packages/apis/instructor-api/src/middleware/core-table.ts`), and `procedures/category.ts` with `create`, `rename`, `archive` and `list` over `categoryWrites`; register in `router.ts`. Local server decodes Carol's token as the generated pattern does.
- [x] T033 [US3] Admin portal "Categories" screen under `packages/websites/admin-portal/src/routes/categories/` with a navigation link: table (name, slug, status, course count), "Add category", inline rename, "Archive" with confirmation; text buttons only.
- [x] T034 [P] [US3] `seed-categories` Nx target and script in `packages/common/scripts/src/` (declare it in that project's `project.json`): writes Science, Technology, Mathematics, Communication and Business through `categoryWrites`, idempotent by name, working against local DynamoDB and, with stage credentials, the development stage. Add a unit test for the idempotence with the table mocked.
- [x] T035 [US3] Run the US3 unit and component tests plus `pnpm nx synth @discava/infra` and `pnpm nx run @discava/infra:checkov`: confirm the new stack stays well under 500 resources, defaults to hardened settings and has no dependency cycle (plan risk R3). Record the counts in the PR description. The e2e and concurrency tests run on PR CI.

**Checkpoint**: the taxonomy has a real source and a UI.

---

## Phase 6: User Story 4 - Category landing pages (Priority: P2)

**Goal**: a visitor opens `/category/<slug>` and sees that category's published courses with filters, facets and search.

**Independent Test**: open a category's address and check it lists exactly that category's published courses, with facets counted inside it.

### Tests for User Story 4 (write first)

- [x] T036 [P] [US4] Component tests in `packages/websites/student-portal/src/routes/category/-category.test.tsx` per [contracts/portal-ui.md](./contracts/portal-ui.md): heading, results scoped to the category, filter panel without the category group, empty state, not found for an unknown slug, "no longer available" for an archived category, cold-start retry, and the home chips linking to the page.
- [x] T037 [P] [US4] Extend `packages/e2e/src/scenarios/category.e2e.ts`: the landing page lists 100% of the category's published courses and none from another category, facets are counted inside the category, an archived category's address shows "no longer available", and a made-up slug shows not found.

### Implementation for User Story 4

- [x] T038 [US4] Route `packages/websites/student-portal/src/routes/category/$slug.tsx` using `category.bySlug` and `course.publicSearch` with the category's id, sharing the filter panel and results from T020; regenerate the route tree as the repo does; text buttons only.
- [x] T039 [US4] Run the US4 tests locally and fix until green.

**Checkpoint**: browsing has shareable front doors.

---

## Phase 7: User Story 5 - Existing courses become searchable by the new fields (Priority: P3)

**Goal**: the existing re-index Lambda rebuilds documents with the new fields.

**Independent Test**: run the re-index over courses with the new fields and check the documents; run it twice and get the same documents.

- [ ] T040 [P] [US5] Extend `packages/events/src/search/search-reindex.test.ts` (add cases, change no assertion): courses with all five fields reindex with them; a course with a category refers to its current `categoryId`; running twice leaves the same documents; courses without fields reindex without them. No handler change is expected beyond T011; if the handler maps fields itself, route it through `toCourseDocument`.
- [ ] T041 [US5] Make the local dev paths cover the fields: extend `packages/common/scripts/src/opensearch/sync-local-indices.ts` only if the mapping needs it (it should not), and extend the `e2e:seed-local-courses` target in `packages/e2e` so seeded courses carry categories, tags, level, language and duration; run the events and search tests.
- [ ] T042 [US5] Document the rollout in `docs/src/content/docs/en/design/search.mdx`: the new fields and their mapping, that the change is additive so `putMapping` applies in place (#270 covers breaking changes), why the document stores `categoryId` not the name, the facet query shape, and the step "invoke the re-index Lambda once after deploying" with the command from `packages/common/scripts/src/infra/reindex-search.ts`'s Nx target. Translate any changed English docs page locally and commit the translations, or note in the PR description that translations are pending.

**Checkpoint**: an existing stage can be brought up to date with one invocation.

---

## Phase 8: Polish and cross-cutting

- [ ] T043 [P] Update the docs site (`docs/`) where it describes courses, the instructor flow or the admin portal (categories, tags and the course fields), and `CONTRIBUTING.md` or `CLAUDE.md` architecture notes to mention `admin-api`; translate changed English docs pages locally or note pending translations in the PR description.
- [ ] T044 Run `pnpm lint`, `pnpm test` and `pnpm build`; fix every failure in the code, not the tests. Run `pnpm tsx packages/common/scripts/src/agent-issues/validate-main.ts` and `graphify update .`.
- [ ] T045 **(human)** Run [quickstart.md](./quickstart.md) by hand against `pnpm dev`, saving numbered screenshots of the key steps, including any failure, to `tmp/screenshots/pr-<number>/`. Also check SC-002 (narrow 100 courses to one in under 30 seconds) and SC-008 (95% of requests under 2 seconds once search is awake).
- [ ] T046 **(human)** After deploying to `discava-development`, invoke the re-index Lambda once, confirm published courses appear under the facets, and confirm the OpenSearch Serverless collection returns the facet aggregations (plan risk R1); flag on the PR if it does not.

---

## Dependencies and order

- Phase 1 → Phase 2 → stories. Within Phase 2: T002 → T003 → T004 → T005 and T006 (both use T004) → T007 → T008; T009 after T002; T010 → T011 are independent of the table tasks.
- **US1** depends only on Phase 2 (its e2e seeds through the helpers). **US2** is independent of US1 on the backend and can run alongside it, but its e2e reads US1's facets. **US3** is independent of US1 and US2 (its `admin-api` scaffold touches new files only) except T029 follows T031. **US4** needs US1's filter panel and `category.bySlug` (T016 to T020). **US5** needs only T011.
- Tests in each story come before its implementation.

## Parallel examples

- Phase 2: T004 and T010 together; T009 once T002 is done.
- US1: T012, T013, T014 together; then the backend (T016 to T019) alongside the portal (T020) once the schemas exist.
- After Phase 2: US1, US2 and US3 backends in parallel; US5's T040 at any time after T011.

## Implementation strategy

- **MVP**: Phase 1, Phase 2 and US1. Visitors filter with correct counts; data comes from helpers and seeds until US2 and US3 land. Instructor fields, the admin taxonomy, landing pages and the re-index follow as separate, reviewable increments.
- Deliver in the order US1 → US2 → US3 → US4 → US5; each checkpoint leaves the table passing the invariant check.
- The additive-mapping test (T010) and the facet query (T017) are the riskiest pieces: land and verify them before building on them.
