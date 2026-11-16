# Implementation Plan: Core Table Stream Event Router

**Branch**: `20261116-183449-stream-event-router` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261116-183449-stream-event-router/spec.md`

## Summary

One router Lambda becomes the only consumer of the core table's stream. It filters each record with the filters features already define and sends it to that feature's SQS queue. Each feature has its own queue, failure queue, alarm and handler mapping. Progress recalculation and search indexing move onto it first, behaviour-preserving, so the stream stays at one consumer when notifications (#331) and the dashboard (#332) arrive.

The queues don't keep per-record order, so every handler has to be order-safe. Progress recalculation already is. Search indexing becomes so by re-reading the course from the core table on each change, not by versioning its writes (research R-3). Locally, the event runner runs the same router function against ElasticMQ queues behind a `QueueClient` interface, with an in-process queue as the fallback if a first-task spike rules ElasticMQ out (research R-2).

Facts the repo showed that shaped the plan:

1. The two existing consumers are `DynamoEventSource` mappings in `packages/infra/src/stacks/core-api-stack.ts` (progress at line 250, search at line 305), each with its own failure queue, filtered by `PROGRESS_STREAM_FILTERS` and `SEARCH_STREAM_FILTERS` (core-table helpers). That is the AWS guideline's maximum of two readers per shard.
2. The local event runner (`packages/events/src/local/event-runner.ts`) already reads the local stream, applies the same filters, batches (100 records or 5 s) and calls the handlers in-process. Its failures are "logged, not retried"; retries, bisecting and failure queues exist only when deployed. The router work adds those locally.
3. Progress recalculation recomputes from the table on every run, so it is order-insensitive. Search indexing builds its document from the stream record and writes it, so it is not.
4. The search collection is an OpenSearch Serverless `SEARCH` collection, for which external versioning is not documented. This is why R-3 re-reads the course instead.
5. Local containers follow one pattern: `start-container.ts` and an Nx target in `common-scripts`, settings in `common-server-utils/local-dev` (S3Mock is the closest model).

## Technical Context

**Language/Version**: TypeScript (Node 24 Lambdas), pnpm/Nx monorepo

**Primary Dependencies**: `@aws-sdk/client-sqs` (new, `events` and `common-server-utils`), existing `@discava/core-table` (ElectroDB), `@aws-lambda-powertools/*` and middy (as the existing handlers), `aws-cdk-lib` (`aws-sqs`, `aws-lambda-event-sources`, `aws-cloudwatch`), ElasticMQ in Docker for local dev (pending the R-2 spike)

**Storage**: no new entity, table or index. The search handler adds a keyed read of the `course` entity. Queues carry stream records as JSON

**Testing**: vitest per project (with the `@discava/core-table` alias), the router and handlers unit-tested against a fake `QueueClient`, Playwright e2e in `packages/e2e` for progress and search through the router, and ElasticMQ-backed tests in CI only (the constitution says agents don't run Docker)

**Target Platform**: AWS Lambda, SQS, DynamoDB Streams, CloudWatch (deployed); `pnpm dev` with Docker (DynamoDB local, ElasticMQ, the event runner) locally, no AWS account

**Project Type**: serverless backend (events, core-table, infra, constructs) plus local tooling. No portal or API change

**Performance Goals**: a change reaches its handler within the same window as today plus a few seconds for the extra hop (the router batches for 1 second and each feature queue for 5, so the windows don't stack to 10); a burst still collapses to one recalculation per course per batch

**Constraints**: exactly one stream consumer (FR-001); no compatibility layer, the old direct mappings are deleted in the same change (FR-010); no existing test weakened (FR-009); the 500-resource cap per stack (new `StreamRouter` stack, R-5); least privilege (the search handler gains core-table read only, the router gains queue send only); stateful resources stay in `Data`; SPDX headers are generator-managed

**Scale/Scope**: two features now, two more soon (#331, #332). Tens to thousands of changes a day. Course, curriculum and completion records are far below the queue message limit

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | Lambda, SQS, DynamoDB Streams, CloudWatch. No pluggable layer: the router calls SQS directly, with a `QueueClient` interface only so tests and local dev can swap the transport |
| II. Generators first | Pass, planned | The router Lambda and any new handler wrapper come from `ts#lambda-function` in `packages/events` (`project.json` already lists one entry per handler). The `StreamRouter` stack and constructs are hand-written because no generator creates a stack of queues and mappings; the plan says so |
| III. Everything runs locally | Pass, conditional | The event runner runs the router function and feature runners against ElasticMQ, or the in-process fallback. The R-2 spike decides, and the fallback needs no Docker, so the principle holds either way |
| IV. Layered tests | Pass, planned | Unit tests per router/adapter/handler; reordered and duplicate delivery tests for search and progress (SC-004); a failure-destination test (SC-005); e2e scenarios for progress and search unchanged; the invariant check after every e2e test stays. No new invariant, see the impact check |
| V. Single-table via ElectroDB | Pass | Search reads one `course` by key through `@discava/core-table`, no scan. The wording that names progress and search as the stream's consumers is updated (FR-024). `PROGRESS_STREAM_FILTERS` and `SEARCH_STREAM_FILTERS` stay and feed the registry |
| VI. Secure by default | Pass | Queues default to customer-managed KMS with key rotation, `enforceSSL`, least-privilege grants per function. A new `streamRouter` component config (`enableKmsEncryption`, `enableKeyRotation`) lets a stage relax it, as the core table's does, so only `stages.config.ts` relaxes it and `discava-production` keeps the default |
| VII. Change freely before launch | Pass | Old mappings and failure queues are removed outright; no dual-running |
| VIII. Repo conventions | Pass | New code under `helpers/` (one file per topic) in core-table and shared modules in `common-server-utils`; no `utils.ts`; docs in English, with translations noted if docs change |

**Complexity Tracking**: empty. The queues follow the repo's per-component encryption switch, so there is no deviation from principle VI.

**Re-check after design**: still passing.

## Impact Check (shared records)

| Record | Use | Existing invariants and tests |
|--------|-----|-------------------------------|
| `course` | Read by key in the search handler (new) | Course entity tests; the `search-reindex` tests cover document building. No write |
| `enrolment`, `itemCompletion`, curriculum entities | Read as today by progress recalculation | `progress/recalculate.test.ts`, core-table invariants for progress; unchanged |
| Every entity on the stream | Seen by the router for filtering only; nothing is written | The progress and search filter tests (`*-stream.test.ts`) keep covering the filters |

No new counted or related record and no meaning changed, so no existing invariant is extended and none is added. The e2e invariant check after every test stays as it is. It must still wait for stream lag; the extra queue hop adds a few seconds, so the e2e helpers that wait for progress and search settle on the final state (a task checks them).

## Design Decisions (detail in [research.md](./research.md))

1. **A router Lambda, not a Pipe plus bus (R-1).** One stream mapping, the router, sends each record to the queues of the features whose filter matches. Filters are the existing helpers plus a registry.
2. **A registry of features, one file (contract: [stream-feature-registration.md](./contracts/stream-feature-registration.md)).** Each feature is one entry: name, filters, handler name, queue and batching settings. The deployed stack and the local runner both read it; a test fails on a missing handler or a filter that matches nothing (FR-022).
3. **Handlers keep their code behind an adapter (R-5).** SQS batch in, the stream event shape out, so the handlers' parsers and tests stay.
4. **Search re-reads the course (R-3).** No version parameters and no new field.
5. **Failures are per feature (R-4, R-6).** Retries by receive count, a failure queue and an alarm per feature, plus the router's own failure queue.
6. **Local parity (R-2).** One `QueueClient` interface with an ElasticMQ implementation and an in-process one. The local runner polls each feature's queue, batches like the mapping does, runs the handler, and deletes or keeps messages on the result. A runner endpoint lists queues and redrives (contract: [local-runner-routes.md](./contracts/local-runner-routes.md)).
7. **No message loss on size (R-4).** The router refuses an oversized message loudly (router failure queue and alarm).

## Access patterns (all keyed; no scans in a request)

| Pattern | Key |
|---|---|
| Current state of a changed course (search handler) | `course` get by `courseId` |
| Students to recalculate, curriculum (progress, as today) | existing `enrolment` range and curriculum collection |
| Invariant checks | full scan, in tooling only, as today |

## Project Structure

### Documentation (this feature)

```text
specs/20261116-183449-stream-event-router/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── stream-feature-registration.md
│   ├── router-message.md
│   └── local-runner-routes.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
packages/
├── databases/core-table/src/helpers/
│   ├── stream-features.ts            # the registry: STREAM_FEATURES (+ test)
│   ├── progress-stream.ts            # unchanged: feeds the registry
│   └── search-stream.ts              # unchanged: feeds the registry
├── events/src/
│   ├── router/
│   │   ├── stream-router.ts          # the router Lambda handler (+ test)
│   │   ├── route-records.ts          # pure: records + registry -> messages per feature (+ test)
│   │   ├── sqs-stream-records.ts     # adapter: SQS event -> stream event for handlers (+ test)
│   │   └── queue-client.ts           # QueueClient interface; SQS implementation (+ test)
│   ├── progress/progress-recalculation.ts   # unchanged logic
│   ├── search/index-content.ts       # re-reads the course (+ test changes, R-3)
│   └── local/
│       ├── event-runner.ts           # runs the router and feature runners instead of two batchers
│       ├── feature-runner.ts         # polls a queue, batches, runs the handler, retries, failure queue (+ test)
│       ├── in-process-queue.ts       # fallback QueueClient (+ test)
│       └── event-runner-server.ts    # + GET /router/queues, POST /router/redrive/{feature}
├── common/
│   ├── constructs/src/app/lambda-functions/events-stream-router.ts   # generator-owned wrapper
│   ├── constructs/src/core/stream-router.ts    # construct: router, per-feature queues, alarms, mappings (+ test)
│   ├── server-utils/src/local-dev.ts           # + ElasticMQ endpoint and queue names
│   └── scripts/src/elasticmq/start-container.ts  # + Nx target, like s3mock (+ config file with the queues)
├── infra/src/stacks/stream-router-stack.ts     # new stack; core-api-stack.ts loses the two mappings
└── e2e/src/
    ├── scenarios/router.e2e.ts                 # routing through the queues
    ├── scenarios/router-failure.e2e.ts         # failure queue and redrive via the runner routes
    ├── concurrency/router-ordering.e2e.ts      # publish, unpublish and edit races end in the table's state
    └── helpers/router.ts                       # runner calls; other helpers: settle-on-final-state waits (if needed)
docs/                                           # contributor page for the per-feature pattern (FR-023)
.specify/memory/constitution.md                 # stream-consumer wording (FR-024), in the implementation PR
```

**Structure Decision**: no new package. The registry lives with the other stream helpers in `core-table` so the stack and the runner import one definition, as they import the filters today. The router and adapter live in `packages/events` beside the handlers they serve. The construct sits in `common/constructs` (a construct owns one component's resources) and `packages/infra` composes it into a new stack.

## Phases the work splits into (agent-sized pull requests)

The task list will hold the detail; the order and the independence are:

1. Foundation: the local queue spike (human), `QueueClient` and the in-process queue, the registry, the pure router and adapter.
2. The router and the feature runner locally: progress and search routed in the event runner, the runner routes, and the new e2e scenarios, with the existing e2e passing. The ordering e2e is the one exception to "independent of phase 3": it waits for phase 3's search change, because it fails on the old behaviour.
3. Search re-read, with the ordering and duplicate tests and the table read grant. It can run alongside phase 2.
4. The `StreamRouter` construct, stage config and stack, the generator wrapper, alarms; the two old mappings removed.
5. Docs, the constitution wording, and the list of what #331 and #332 change.
6. Polish: the deployed check, `build`, `lint`, `test`.

Phase 2 changes only local development and phase 3 changes only search's behaviour (correct under today's ordering too), so `main` stays working after each. Phase 4 cannot ship before phase 2, so the deployed and local routing never disagree.
