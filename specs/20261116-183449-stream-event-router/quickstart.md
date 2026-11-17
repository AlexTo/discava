# Quickstart: validating the router

How to check each user story once the work is built. Contracts and shapes are in [contracts/](./contracts/) and [data-model.md](./data-model.md), not repeated here.

## Prerequisites

- `pnpm i`.
- For the unit and build checks: nothing else.
- For the local-stack checks: Docker, then `pnpm dev`. These checks run in CI's e2e job. A task never requires an agent to run them (constitution).

## 1. Routing and one consumer (User Story 1, FR-001 to FR-006)

```sh
pnpm nx run @discava/events:test -- --run route-records stream-router
pnpm nx run @discava/core-table:test -- --run stream-features
```

Expect: a record reaches exactly the features whose filter matches, a record matching two features is copied to both, one matching none produces no message. The registry test fails on a repeated name, a missing handler or a filter that matches nothing.

Deployed check, after a `synth`: the stack has one stream event source mapping on the core table, and none in `CoreApi`.

```sh
pnpm nx synth @discava/infra
```

## 2. Progress and search unchanged (User Story 2)

```sh
pnpm nx run @discava/events:test
pnpm nx e2e @discava/e2e
```

Expect: the existing progress and search tests and e2e scenarios pass with no edits. In `pnpm dev`, complete a lesson as a student and watch the runner log a routed record and a handler run for `progress-recalculation`.

## 3. Order and duplicates (User Story 3, FR-011 to FR-015)

```sh
pnpm nx run @discava/events:test -- --run index-content progress-recalculation
```

Expect: search tests deliver, for one course, "published" then "unpublished" in both orders and twice, and the index ends the same each time; a removed course stays out when an older edit arrives afterwards; a change naming no course fails. Progress tests show the same result for duplicate and reordered batches.

## 4. Failures per feature (User Story 4, FR-016 to FR-019)

```sh
pnpm nx run @discava/events:test -- --run feature-runner
pnpm nx run @discava/common-constructs:test -- --run stream-router
```

Expect: a handler that always throws sends its messages to its own failure queue after `maxReceiveCount` receives while another feature keeps processing; the construct test shows one failure queue and one alarm per feature plus the router's.

Local, with `pnpm dev` running: make search fail its next 5 batches, change a course, then look at the queues and redrive:

```sh
curl -X POST http://localhost:2024/router/fail/search-indexing -d '{"batches": 5}'
# publish or edit a course in the instructor portal, then wait a few seconds
curl http://localhost:2024/router/queues
curl -X POST http://localhost:2024/router/redrive/search-indexing
```

Expect the failure count for `search-indexing` to show (progress's stays 0), then to move back after redrive, and the course to appear in search.

## 5. Local parity (User Story 5, FR-020 to FR-022)

Run the event runner's tests. Expect: the local router and the deployed router both call `featuresFor`, a registration with a missing handler or an unmatched filter fails a test, and burst collapsing holds (a burst of edits to one course produces one recalculation).

## 6. End to end (User Stories 1 to 5)

PR CI runs these against the local stack (`pnpm nx e2e @discava/e2e` locally, with `pnpm dev` or letting Playwright start it):

- `router.e2e.ts`: progress and search follow a course and a completion through the queues, and no failure queue holds work from the scenario.
- `router-failure.e2e.ts`: a forced search failure ends in search's failure queue while progress keeps working, and a redrive restores the course in the index.
- `router-ordering.e2e.ts` (concurrency): rapid publish, unpublish and edit of one course end with search matching the table's final state.

## Before merging

```sh
pnpm build
pnpm lint
```
