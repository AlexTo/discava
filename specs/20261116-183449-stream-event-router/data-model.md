# Data Model: Core Table Stream Event Router

No new table entity, index or stored record. The things this feature defines are code-level shapes and infrastructure resources.

## Feature registration (code)

One entry per feature in `STREAM_FEATURES` (`core-table/src/helpers/stream-features.ts`). See [contracts/stream-feature-registration.md](./contracts/stream-feature-registration.md).

| Field | Notes |
|-------|-------|
| `name` | Unique, kebab-case (`progress-recalculation`, `search-indexing`). Names the queue, failure queue, alarm and handler |
| `filters` | The feature's existing filter list: `{ eventName, image, entities }[]`. The same value the deployed router and the local router use |
| `handler` | The name of the handler the feature's mapping invokes. A test checks it exists |
| `batch` | `{ maxRecords, windowSeconds }`. Progress and search: 100 and 5 |
| `maxReceiveCount` | Receives before a message goes to the failure queue. Progress and search: 5 |
| `maxConcurrency` | Optional cap on concurrent handler runs. Search sets the minimum the mapping allows (2) |

Rules: a name is registered once; every filter matches at least one entity the table defines (a test reads the entity list); a registration changes only this file, the handler and its tests (FR-005).

## Router message (queue)

One stream record as JSON, in the shape a Lambda receives from a stream mapping, so handlers parse it unchanged. See [contracts/router-message.md](./contracts/router-message.md).

| Part | Notes |
|------|-------|
| Body | The stream record: `eventID`, `eventName`, `eventSourceARN`, and `dynamodb` (keys, old and new image, sequence number, approximate time) |
| Message attributes | `feature` (the registration name) and `entity` (the record's `__edb_e__`), for inspection in a failure queue |
| Size | Under the SQS message limit, or refused by the router (research R-4) |

## Queues and failure queues (infrastructure)

Per feature: one standard queue, one failure queue, one alarm, one handler mapping. Plus the router's own failure queue and alarm.

| Resource | Settings |
|----------|----------|
| Feature queue | Standard, one KMS key for the component with rotation by default (`streamRouter.enableKmsEncryption` and `enableKeyRotation` in the stage config; off falls back to SQS-managed encryption, as `discava-development` does for its other components), `enforceSSL`, visibility timeout at least six times the handler's function timeout (AWS guidance for SQS-triggered Lambda), redrive to the failure queue after `maxReceiveCount` |
| Failure queue | 14-day retention (as today's), the same encryption as the feature queues, `enforceSSL` |
| Alarm | `ApproximateNumberOfMessagesVisible` > 0 on the failure queue, no action |
| Router failure queue | The router mapping's `onFailure` destination, same settings |

## Local runner state (not persisted)

| State | Notes |
|-------|-------|
| Per-feature queue and failure queue | ElasticMQ queues created from the mounted config file, or in-process lists. Cleared by `reset-local-data` (ElasticMQ is in-memory) |
| Per-feature batch buffer | In the runner process, as `createBatcher` holds today |

## State transitions

A message: sent by the router → received by the feature runner (visible again after the visibility timeout if not deleted) → deleted on success, or after `maxReceiveCount` receives → failure queue → redriven back to the feature queue, or left.

## What search reads (R-3)

The search handler reads `course` by `courseId` through `@discava/core-table`. It writes nothing to the table.
