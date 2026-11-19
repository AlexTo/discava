# Implementation Plan: Search Suggestions as You Type

**Branch**: `20261119-195009-search-suggestions` | **Date**: 2026-11-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261119-195009-search-suggestions/spec.md`

## Summary

As a visitor types 3 or more characters in the student portal's top-bar search box, a dropdown lists up to 10 published courses whose titles match, with the last word matched as a prefix. Picking one opens the course page. A new public, read-only core-api procedure, `course.publicSuggest`, runs a small prefix query against the existing `courses` OpenSearch index: no new mapping, no re-index, and no core-table change. The portal waits 300 ms after the last keystroke before asking, caches each answer under its own text, so an older answer can never replace a newer one, and renders a hand-built, accessible combobox around the existing search input.

## Technical Context

**Language/Version**: TypeScript (Node 22 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC and zod (`@discava/core-api`), `@opensearch-project/opensearch` through `@discava/search`, TanStack Router and Query (student portal), shadcn `Input` from `@discava/common-shadcn`, `usePublicMediaUrl` from `@discava/common-web-utils/public-media-url`. No new runtime library (R-4).

**Storage**: None new. Reads the existing `courses` index. Its mapping is unchanged (R-1). Nothing is written to the core table.

**Testing**: vitest unit tests for the query builder and the procedure (OpenSearch client mocked, as `search.test.ts` does), `router.test.ts`'s public-operations check, student-portal component tests with `renderWithCoreApi` and fake timers for the debounce, and an extended Playwright scenario (`packages/e2e/src/scenarios/search.e2e.ts`) with `screenshot()`.

**Target Platform**: AWS Lambda behind API Gateway (core-api), OpenSearch Serverless (NextGen). Locally, `pnpm dev` with the OpenSearch container.

**Project Type**: Web application: a serverless backend plus React portals.

**Performance Goals**: With search warm, suggestions show within 1 s of the pause for 95% of pauses (SC-001). Each request returns at most 10 hits with three source fields, and no aggregations or total count.

**Constraints**:
- One request per typing pause (300 ms debounce) and none for text under 3 characters.
- Only published courses, enforced in the query as well as at index time.
- Fails quietly: a timeout or error never shows an error in the top bar.
- Public: works signed out, under core-api's WAF and an API Gateway throttle of its own (`publicSuggestThrottle*`, 5/s on development and 100/s on production), since the shared public throttle is too tight for typing traffic (R-6).
- Works under `pnpm dev`.

**Scale/Scope**: One procedure, one query-builder function, one component and one hook in the student portal, one e2e test, and one design-page section. The catalogue size is whatever the `courses` index holds. The query is bounded at 10 hits.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design: still passes.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | Reuses the OpenSearch Serverless collection and core-api Lambda. No new service |
| II. Generators first | Pass | No new project or component: a procedure in an existing tRPC API and a component in an existing portal. No generator applies (adding a tRPC procedure has none) |
| III. Everything runs locally | Pass | The same local OpenSearch container serves the query. `match_bool_prefix` is supported in OpenSearch 3.x, which local and Serverless both run (R-1) |
| IV. Layered tests | Pass, planned | Unit tests for `buildSuggestRequest` and `course.publicSuggest` (published-only filter, 10-hit cap, timeout mapping, input bounds). Portal component tests for threshold, debounce, stale answers, keyboard and ARIA. One new e2e test. No invariant applies: no shared record is written (impact check below) |
| V. Single-table via ElectroDB | Pass | No core-table access at all: the procedure reads only the search index. No scan, no new index. `STREAM_FEATURES` unchanged |
| VI. Secure by default | Pass | Same WAF as `course.publicSearch`, and a throttle of its own, set per stage and still bounded (R-6). Input is bounded (3 to 200 characters) and sent as query text, never as query syntax. Output is three fields of published courses. Highlighting is done in the portal on plain text, so no server HTML is injected (R-5) |
| VII. Change freely before launch | Pass | The search box's role changes from `searchbox` to `combobox`. The e2e helper that finds it is updated outright, with no alias |
| VIII. Repo conventions | Pass | `core-api/src/helpers/suggest-query.ts` beside `search-query.ts`. Portal code stays in the student portal (the only consumer): `components/site-search-suggestions.tsx`, `hooks/use-debounced-value.ts`, `lib/title-highlight.ts`. Text-only rows, no arrow icons. Screenshots in e2e. English docs section, with translations pending noted in the PR |

**Impact check (constitution IV).** This feature writes no shared record and reads none in a new way. It reads only the `courses` search index, through the same `publicSearchProcedure` middleware as `course.publicSearch`. The existing search stream tests (`search-stream.test.ts`) and the e2e test "a published course is searchable, and gone once archived" already cover what the index holds. The new e2e test adds the same publish/archive check for suggestions.

**Weakened or changed tests (constitution IV).** `searchWithSiteSearch` in `packages/e2e/src/helpers/student-portal.ts` finds the box by role `searchbox`. Under the combobox pattern its role becomes `combobox` (FR-012), so the helper's locator changes to `getByRole('combobox', { name: 'Search courses' })`. Its behavior (fill, Enter, wait for `/search`) is unchanged. The task that changes it names this, and the implementation PR says so.

## Design Decisions (detail in [research.md](./research.md))

1. **Prefix query on the existing `title` field** (R-1): a `match_bool_prefix` on `title` (English analyzer, as indexed), scored like full search, with the rating boost and newest as a tiebreak. No mapping change or re-index. A `search_as_you_type` sub-field is the follow-up if matching a part-typed word against its stem proves weak.
2. **A separate, smaller procedure** (R-2): `course.publicSuggest` instead of reusing `course.publicSearch`, so suggestions skip facets, category reads and counts, and get a shorter timeout (3 s).
3. **The answer is cached under its text** (R-3): a TanStack Query keyed by the debounced text gives last-text-wins (FR-008) and reuse (FR-009, `staleTime` 60 s) for free. `placeholderData` keeps the previous list visible while the next one loads.
4. **A hand-built ARIA combobox** (R-4) around the existing `Input`, following the WAI-ARIA APG "combobox with listbox popup" pattern, instead of adding cmdk. A polite live region announces the count.
5. **Highlighting in the portal** (R-5): the matched word prefixes are emphasized with `<mark>` from plain text, not from OpenSearch's HTML highlighter.
6. **Silent failure** (R-6): errors, 429s and `TIMEOUT` close the dropdown, or keep the last list. They're never shown as an `ErrorAlert` in the top bar.
7. **A throttle of its own** (R-6): listing the method in `PUBLIC_OPERATIONS` would otherwise give it `publicThrottle` (1/s on development, 20/s on production, shared by every caller). Two new `coreApi` stage keys, `publicSuggestThrottleRateLimit` and `publicSuggestThrottleBurstLimit`, set it instead.

## Project Structure

### Documentation (this feature)

```text
specs/20261119-195009-search-suggestions/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R-1 to R-6
├── data-model.md        # Phase 1: the Suggestion shape and the index fields it reads
├── quickstart.md        # Phase 1: how to check it by hand
├── contracts/
│   ├── core-api-suggest.md   # course.publicSuggest input, output, errors
│   └── site-search-ui.md     # the search box's behavior and ARIA contract
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/apis/core-api/src/
├── schema/search.ts                 # + SuggestCoursesInputSchema, SuggestCoursesOutputSchema
├── helpers/suggest-query.ts         # new: buildSuggestRequest(input)
├── helpers/suggest-query.test.ts    # new
├── procedures/search.ts             # + publicSuggestCourses
├── procedures/search.test.ts        # + publicSuggest cases
├── router.ts                        # course.publicSuggest, and PUBLIC_OPERATIONS += 'course.publicSuggest'
└── router.test.ts                   # existing public-operations check covers the new entry

packages/common/infra-config/src/
├── stages.types.ts                  # + publicSuggestThrottleRateLimit, publicSuggestThrottleBurstLimit on coreApi
├── stages.config.ts                 # development 5 / 10, production 100 / 200
└── env-overrides.ts                 # + the two keys as numbers

packages/common/constructs/src/app/apis/
├── core-api.ts                      # + publicSuggestThrottle prop, applied to course.publicSuggest instead of publicThrottle
└── core-api.test.ts                 # + the suggest method gets its own throttle

packages/infra/src/stacks/
├── api-limits.ts                    # + publicSuggestThrottle(config), default 100 / 200
└── core-api-stack.ts                # passes publicSuggestThrottle to CoreApi

packages/websites/student-portal/src/
├── components/site-search.tsx                   # combobox wiring, keyboard handling, submit cancels pending
├── components/site-search-suggestions.tsx       # new: listbox, rows, "See all results", live region
├── components/site-search.test.tsx              # new
├── hooks/use-debounced-value.ts                 # new
├── hooks/use-debounced-value.test.ts            # new
├── lib/title-highlight.ts                       # new: split a title into matched and unmatched parts
└── lib/title-highlight.test.ts                  # new

packages/e2e/src/
├── helpers/student-portal.ts        # searchWithSiteSearch uses role combobox; + suggestInSiteSearch
└── scenarios/search.e2e.ts          # + "suggestions offer a published course by the start of its title"

docs/src/content/docs/en/design/search.mdx   # + "Suggestions" section and "Spec" link
```

**Structure Decision**: The backend change is confined to core-api's existing search procedure file and a new helper beside `search-query.ts`. The frontend change stays in the student portal, because no other portal has this search box. Nothing goes in `common-shadcn` or `common-web-utils` until a second portal needs it (constitution VIII). `CoreApi` in `common-constructs` reads `PUBLIC_OPERATIONS` to skip the Cognito authorizer. The one other infra change is the suggest throttle: two stage config keys, a `CoreApi` prop that overrides `publicThrottle` for `course.publicSuggest`, and the stack passing it through, like `publicThrottle` today (R-6).

## Complexity Tracking

No violations to justify.
