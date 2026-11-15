# Implementation Plan: Catalogue Categories, Tags and Richer Filters

**Branch**: `20261115-000000-catalogue-categories` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261115-000000-catalogue-categories/spec.md`

## Summary

Courses gain an optional category (from an admin-managed flat taxonomy), tags, level, language and estimated duration. Instructors set them through instructor-api's course procedures. Published courses are indexed with the new fields (additive mapping on the existing `courses` index), and core-api's `course.publicSearch` gains filters, facet aggregations and filter-only browsing. A new public `category.list` and `category.bySlug` back the catalogue home and landing pages. Admins manage categories through a new admin API (generated), used by a new admin-portal screen. The student portal's catalogue and search page replace their mock categories with real facets, and landing pages live at `/category/<slug>`.

Design points the code forced:

1. **The index holds `categoryId`, not the name.** Names and archived state are read from the core table (one small partition) when a response is built. A rename or archive therefore never touches the index, `SEARCH_STREAM_FILTERS` stays course-only, and counts and names can't drift.
2. **No admin backend exists.** Only core-api and instructor-api do; the admin portal is a stub. Constitution II requires a generator: the plan scaffolds `admin-api` with the `ts#trpc-api` generator and wires the admin portal to it with the `connection` generator.
3. **Facet counts need a `post_filter` query.** The text query and `status` go in the query; the user's filters go in `post_filter` for the hits, and each facet is a `filter` aggregation that applies every filter except its own. That gives counts that exclude the facet's own selection (FR-010) in one request.
4. **The mock data in `course-display.ts`** (categories, levels, durations) is deleted and replaced by real fields.

## Technical Context

**Language/Version**: TypeScript (Node 22 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC + zod, ElectroDB (`@discava/core-table`), `@opensearch-project/opensearch` via `@discava/search`, TanStack Router/Query, shadcn (`@discava/common-shadcn`), CDK constructs

**Storage**: the one DynamoDB core table (new `category` and `categoryClaim` entities, new attributes on `course`); the OpenSearch `courses` index

**Testing**: vitest per project (with the `@discava/core-table` alias in each `vitest.config.mts`), core-table `helpers/invariants.ts`, Playwright e2e in `packages/e2e` including `src/concurrency/`, search-index tests against the local OpenSearch container only in e2e

**Target Platform**: AWS Lambda + API Gateway + OpenSearch Serverless (deployed); `pnpm dev` with Docker (DynamoDB local, local OpenSearch, event runner, local OIDC) locally

**Project Type**: web application: serverless backend + three React portals

**Performance Goals**: one search request per page view (hits plus all facets); 95% under 2 s once the collection is awake (SC-008); category names come from one keyed query of at most a few hundred records

**Constraints**: no scans in user requests; the category list is a single-partition query; CloudFormation 500-resource cap per stack (AdminApi is a new stack); mapping change must be additive (#270)

**Scale/Scope**: tens of categories, hundreds to thousands of courses, up to 8 tags per course

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | Lambda, API Gateway, OpenSearch Serverless, DynamoDB |
| II. Generators first | Pass | `admin-api` is scaffolded with `ts#trpc-api` and connected to the admin portal with `connection`; the plan's first foundation task consults `generator-guide` and records what the generators produced. The `category`/`categoryClaim` entities and search-document changes are hand-written because no generator covers entities (same as existing entities) |
| III. Everything runs locally | Pass | Local OpenSearch and `sync-local-indices.ts` already exist; the generated admin API's `dev` target and local OIDC (Carol is admin) cover management; a seed script fills categories and the e2e seeding helper fills tagged courses |
| IV. Layered tests | Pass, planned | Unit tests for every procedure and helper; invariants plus breaking tests; extended `search.e2e.ts` for facet counts; a concurrency test for same-name category creation. See Impact Check |
| V. Single-table via ElectroDB | Pass | Access patterns in [data-model.md](./data-model.md); all keyed. One index added: none (categories share a fixed partition). Search stream consumers: `SEARCH_STREAM_FILTERS` already reacts to every course INSERT/MODIFY, so new course attributes need no filter change; stated and tested |
| VI. Secure by default | Pass | Admin API requires the `admin` group; instructor writes check course instructorship and that the category is active; `category.*` reads expose only name and slug; the AdminApi construct defaults to WAF and hardened settings like the other APIs |
| VII. Change freely before launch | Pass | Course and search document shapes change outright; the old mock helpers are deleted; no fallback for documents lacking the fields (re-index once) |
| VIII. Repo conventions | Pass | Helpers in `core-table/src/helpers/category.ts` and `catalogue.ts`; filter parsing stays in the student portal (one consumer); no arrow icons on buttons; docs updated in English with translations noted |

**Impact check (constitution IV).** Shared records this feature writes or reads in a new way:

| Record | Use | Existing coverage | Change |
|--------|-----|-------------------|--------|
| `course` | New attributes written by instructor-api; `categoryId` must point to an existing category | `curriculum` and course shape checks in `invariants.ts` | New `course-category-exists` check and a breaking test (a course whose category is missing). Course counters, completions and enrolments are untouched |
| `category`, `categoryClaim` | New records, written together | none | New `category-claims-consistent` check (each category has its slug and name claims, each claim points to a category, no two categories share a normalised name) with breaking tests |
| `contentItem` counters, `itemCompletion`, `enrolment`, progress | Not written, not read differently | existing progress and activity checks | None; the feature touches none |
| Stream consumers | Course MODIFY already indexes; categories are not read by search or progress | `SEARCH_STREAM_FILTERS`, `PROGRESS_STREAM_FILTERS` | A test that a `category` record change matches neither filter set |

No violations, so Complexity Tracking is empty. Re-check after design: still passing.

## Design Decisions (detail in [research.md](./research.md))

1. **Taxonomy in the core table.** `category` records live in one partition; uniqueness of slug and normalised name is enforced by `categoryClaim` records created in the same transaction (the single-table way to get unique constraints). Helpers `categoryWrites` (create, rename, archive) in `core-table` are the only writers.
2. **Course fields.** `categoryId`, `tags` (list), `level`, `language`, `durationHours` on `course`, set by one instructor-api `course.updateCatalogue` procedure (replace semantics, clear by omitting) (plus a `category.listActive` picker query) that checks instructorship and, in the same transaction, that the category exists and is active (conditioning on the category record).
3. **Search document.** `courses` gains `categoryId`, `tags`, `level`, `language`, `durationHours` (all keyword except `durationHours`, an integer). Only `putMapping` is needed, which `syncIndices` already does for an existing index; a test pins that the mapping change is additive (#270). `toCourseDocument` is the one builder for the stream indexer and the re-index Lambda (#273), so the re-index covers the fields with no handler change beyond the source type.
4. **Query shape.** `course.publicSearch` input: optional `q`, `categoryId`/`categorySlug`, `tags`, `levels`, `languages`, `durationBands`, `cursor`, `limit`. Hits: `post_filter` of all filters; no `q` sorts by `publishedAt` desc then `courseId`. Facets: per-facet `filter` aggregation excluding its own filters. Duration bands are fixed (`lt2`, `2to10`, `10to40`, `gt40`). The output adds `facets` with category buckets enriched with name and slug (archived categories dropped from facets' list but still filterable by id).
5. **Category reads.** `category.list` (active categories with published counts from one size-0 aggregation) and `category.bySlug` are public operations (added to `PUBLIC_OPERATIONS`).
6. **Admin API.** `category.create`, `rename`, `archive`, `list` (including archived), behind the `admin` group; a screen in the admin portal. A seed script `seed-categories` loads the five placeholder names locally and on the development stage.
7. **Student portal.** Shared `CatalogueFilters` component for home, search and landing pages; filter state in the URL via TanStack Router search params, validated by a parser in `student-portal/src/lib/catalogue-filters.ts`; it moves to `common-web-utils` only if a second portal needs it (research R-8).

## Project Structure

### Documentation (this feature)

```text
specs/20261115-000000-catalogue-categories/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── core-api-catalogue.md
│   ├── admin-api-category.md
│   ├── instructor-api-course-catalogue.md
│   └── portal-ui.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
packages/
├── apis/
│   ├── admin-api/                          # NEW, generated by ts#trpc-api
│   │   └── src/procedures/category.ts      # create, rename, archive, list (+ test)
│   ├── core-api/src/
│   │   ├── procedures/search.ts            # filters, facets, browse
│   │   ├── procedures/category.ts          # list, bySlug (+ test)
│   │   ├── helpers/search-query.ts         # builds query, post_filter, aggregations (+ test)
│   │   ├── schema/search.ts, category.ts
│   │   └── router.ts                       # PUBLIC_OPERATIONS gains category.list, category.bySlug
│   └── instructor-api/src/
│       ├── procedures/course-catalogue.ts  # updateCatalogue (+ test)
│       └── schema/course.ts                # Course gains the fields
├── common/
│   ├── constructs/                         # AdminApi construct from the generator
│   ├── scripts/src/                        # seed-categories
├── databases/
│   ├── core-table/src/
│   │   ├── entities/category.ts, category-claim.ts, course.ts (new attributes)
│   │   ├── helpers/category.ts             # categoryWrites, tag normalisation (+ test)
│   │   └── helpers/invariants.ts           # new checks (+ tests)
│   └── search/src/indices/courses.ts       # additive fields
├── events/src/search/course-document.ts    # new fields in toCourseDocument
├── infra/src/stacks/                       # AdminApi stack; grants
├── websites/
│   ├── admin-portal/src/routes/categories  # management screen
│   ├── instructor-portal/src/...           # catalogue fields form on the course page
│   └── student-portal/src/                 # filters, landing pages; lib/course-display.ts mocks removed
└── e2e/src/                                # search.e2e.ts facets, category.e2e.ts, concurrency
docs/src/content/docs/en/design/search.mdx  # documents the fields and facets
```

**Structure Decision**: one new project (`admin-api`, generated), everything else extends existing packages.

## Risks

- **R1: facet aggregation support on OpenSearch Serverless.** `filter`, `terms` and `range` aggregations are supported on search collections; confirmed in research R-3 and exercised by e2e against the local container, which is the same engine version.
- **R2: tag cardinality.** Terms aggregation is capped at 20 buckets; counts for tags beyond the cap are not shown (spec edge case).
- **R3: stack resource limit and dependency order.** AdminApi is its own stack so CoreApi's resource count is unchanged; verify at synth that the new stack adds no cycle (it reads from `Data` only).
- **R4: pre-existing index documents lack the fields.** Until the re-index runs they appear in no facet value but still in results. Documented in the quickstart and the search design doc.
- **R5: generator output.** The `ts#trpc-api` output may need adjustments (admin group check, local server). Review before building on it.

## Complexity Tracking

*No constitution violations.*
