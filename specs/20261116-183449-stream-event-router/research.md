# Research: Core Table Stream Event Router

Decisions for the three questions the planning input named, plus the smaller ones they forced. Each says what was verified and what was not. Sources are AWS and project documentation read during planning, and the repository as of `main` (`eb839d9`).

## R-1: One stream consumer: a router Lambda, not a Pipe plus event bus

**Decision**: A single router Lambda is the only consumer of the core table's stream. It applies each feature's filter and sends the matching records straight to that feature's SQS queue. There is no EventBridge Pipe and no event bus.

**Rationale**:

- A Pipe's filter can't match the stream record's `eventName` (INSERT, MODIFY, REMOVE): AWS lists `eventName` among the metadata fields that can't be filtered in a Pipe. Today's filters (`PROGRESS_STREAM_FILTERS`, `SEARCH_STREAM_FILTERS`) pair `eventName` with the image and entity, so a Pipe would push that half of every filter to bus rules. The Lambda reuses the existing filter helpers (`matchesProgressStreamFilters`, `matchesSearchStreamFilters`) unchanged.
- The Pipe's L2 construct is an alpha package (`@aws-cdk/aws-pipes-alpha`), whose API can change in any release. The alternative is the raw `CfnPipe` L1. The Lambda needs neither.
- Bus rules would match DynamoDB-JSON shapes (`{"S": "course"}`), and per-entity routing can't happen inside a Pipe (one filter set per pipe). That is a second place for the filters to live, drifting from the local runner.
- Pipe to bus to SQS adds two billed hops and loses ordering at each. The direct path loses it once, at SQS.
- Local dev: the router is plain TypeScript that takes a batch and a queue client. The local runner runs the very same function, so a wrong filter fails locally (FR-020, FR-022). A Pipe has no local equivalent, so the local router would be a second implementation.
- The stream-reader guidance (at most two readers per shard) is met either way, since each is one consumer. AWS documents no exemption for a Pipe, so a Pipe isn't a way around it.

**Costs accepted**: the Lambda is code we own, with its own retries, failure handling and size guard (R-4). At this scale the Lambda path is cents per month, with the fewest billable parts (invocations and SQS requests).

**Alternatives considered**:

- *Pipe to bus to per-feature rules and queues.* Rejected for the reasons above. The deciding ones are the `eventName` limit, the alpha construct and the second filter implementation. It remains the better choice if many unrelated teams must subscribe to table changes without touching the router, which isn't the case here.
- *A Pipe straight to one SQS queue, with the router consuming that queue.* Rejected: it adds a hop and a queue to avoid writing a small Lambda.
- *Each feature keeps its own stream mapping.* Rejected: the problem this feature exists to solve.

**Not verified**: whether a Pipe counts as one of the two readers on a shard (assumed yes, by analogy with an event source mapping); the exact envelope a Pipe produces on a bus; event-pattern size and rule quotas. None of them changes the decision.

## R-2: Local queues: ElasticMQ behind a queue interface

**Decision**: The local stand-in for SQS is ElasticMQ in Docker, started like S3Mock (`start-container.ts` plus an Nx target, settings in `common-server-utils/local-dev`). The router and the local feature runners talk to it through one small `QueueClient` interface, so an in-process queue can replace it without touching handlers. The spike (T001, a human task since it needs Docker) confirmed the open points below; its outcome is recorded after them.

**Rationale**:

- It speaks the SQS API, so duplicate delivery, the visibility timeout and moving a message to a dead-letter queue after `max-receive-count` are real behaviours, not our approximation (documented in its README: the HOCON `dead-letters-queue { name, max-receive-count }` block, `default-visibility-timeout`, FIFO, retention, in-memory by default).
- Multi-architecture images (amd64 and arm64) are published by CI (README).
- Queues and their failure destinations can be created on startup from a mounted config file, so `pnpm dev` needs no setup step.
- The repo already runs Docker stand-ins (DynamoDB local, S3Mock, OpenSearch, the OIDC server), so this fits the existing pattern.

**Alternatives considered**:

- *In-process queues in the event runner.* Rejected once the spike passed: duplicate delivery, visibility and dead-lettering would exist only as far as we code them, so the tests that matter would prove our simulation. The in-memory queue stays as a fake for unit tests, which run without Docker.
- *LocalStack.* Rejected: it brings a large multi-service container for one service, and the project already avoids that (S3Mock instead).
- *`softwaremill/elasticmq-native`.* Rejected: the Docker Hub page calls it "a smaller, faster & experimental version of the docker image".

**Open points the spike settled** (the documentation read did not confirm them):

1. *SDK protocol.* The README documents the SQS query (REST) protocol and mentions no SDK v3 or JSON-protocol compatibility. Newer AWS SDK v3 clients default to the JSON protocol. A release note (v1.6.16) mentions JSON-protocol error handling, so support may exist. The spike runs the repo's SQS client against the container.
2. *Version pinning.* **Pinned at 1.7.1** (decided 2026-11-16), the last stable release; `v2.0.0-rc1` is a release candidate and is not used. The Docker Hub page shows only a `latest` tag and no tag scheme is documented, so the spike confirms the exact tag string (`1.7.1` or `v1.7.1`) with a `docker pull`, and pins by digest if neither exists. It is older than the repo's two-week minimum (as with `mwader/static-ffmpeg:9.0.2`). **Config keys follow 1.x**: the README's kebab-case keys (`dead-letters-queue`, `max-receive-count`, `default-visibility-timeout`) are 2.x. In 1.7.1 they are camelCase (`deadLettersQueue { name, maxReceiveCount }`, `defaultVisibilityTimeout`), and the README says the camelCase names are still read by 2.x with a deprecation warning, so a later upgrade to 2.x is safe.
3. *Redrive.* `StartMessageMoveTask` is not documented in the README (a release note mentions `ListMessageMoveTasks`). So local redrive is a small runner endpoint that reads the failure queue and re-sends (contract: `contracts/local-runner-routes.md`), not the queue service's own redrive. Deployed redrive is the queue service's (FR-017).

**Spike outcome (T001, 2026-11-17): ElasticMQ stays.** Run on an amd64 host with Docker 29.9.3 against `@aws-sdk/client-sqs` 3.1164.0 (the repo's catalog version).

1. *SDK protocol: passes.* `GetQueueUrl`, `SendMessageBatch` (with a message attribute), `ReceiveMessage` (with `ApproximateReceiveCount`) and `GetQueueAttributes` all work with the client's default settings. No protocol override is needed.
2. *Pin: passes.* The tag is `1.7.1` (no `v` prefix); it is a multi-arch manifest list. Digest of the pulled image: `softwaremill/elasticmq@sha256:f1de391a9b8c18fd3f2ce37b4f7d1b8989857e8a8e18bb01284fff899e69da82` (the manifest list's per-platform digests are amd64 `980ff154…` and arm64 `4dd01bb5…`). Pin the tag `1.7.1`.
3. *Dead-lettering: passes.* With the config below, one message was received five times (`ApproximateReceiveCount` 1 to 5, redelivered after the visibility timeout), the sixth receive returned nothing, and the failure queue held the message with its body intact.
4. *Architectures: partly checked.* The manifest lists amd64 and arm64. Only amd64 was started here; arm64 start-up is unverified and T020's CI run, or any arm64 machine, is the first real check.

Config used (HOCON, 1.x camelCase, mounted at `/opt/elasticmq.conf`, port 9324):

```
include classpath("application.conf")
node-address { protocol = http, host = "*", port = 9324, context-path = "" }
rest-sqs { enabled = true, bind-port = 9324, bind-hostname = "0.0.0.0", sqs-limits = strict }
queues {
  test-failures { defaultVisibilityTimeout = 2 seconds }
  test {
    defaultVisibilityTimeout = 2 seconds
    deadLettersQueue { name = "test-failures", maxReceiveCount = 5 }
  }
}
```

Client settings: endpoint `http://localhost:9324`, any region, dummy credentials. Queue URLs come from `GetQueueUrl`.

**Local behaviour kept**: batching (100 records or 5 s) is done by the local feature runner polling its queue, so burst collapsing (FR-008) holds locally.

## R-3: Search order safety: re-read the course, not external versioning

**Decision**: On each batch the search handler takes the distinct course ids from the changes, reads each course's current state from the core table by key, and indexes the course if it is published or removes it if it isn't (or no longer exists). It uses no version parameters. This replaces the spec's first design (external versioning, with removals at the last-updated time plus one millisecond).

**Why the first design was dropped**:

- The search collection is an OpenSearch Serverless `SEARCH` collection (`packages/common/constructs/src/core/opensearch.ts`). AWS's supported-operations page for Serverless lists the index, delete and bulk endpoints but says nothing about the `version` or `version_type` parameters, and no unsupported-parameters list was found. Support is unconfirmed either way, and the local OpenSearch container would support them, so local tests could pass while a deployed collection rejects the call.
- On upstream OpenSearch a delete's version is kept only for `index.gc_deletes` (60 seconds by default). After that an older indexing call can bring a deleted course back. Whether Serverless lets us set that is not documented. So "removal at updatedAt plus 1 ms" would protect for a minute at best.

**Rationale for re-reading**:

- It is the same property progress recalculation already has: the change says which course to look at, and the answer comes from current data, so late, duplicate and reordered deliveries converge.
- It needs only a keyed `GetItem` per course, through `@discava/core-table` (constitution V). The handler gains core-table read access. Today it needs none ("Everything it indexes is on the stream record itself").
- It costs one read per distinct course per batch, fewer reads than records in a burst.
- Course records already keep `updatedAt` current (the entity sets it on every write), but this design no longer depends on it.

**Residual risk, accepted** (spec FR-012): handler A reads a course, the course changes, handler B reads the new state and writes it, then A writes its older read. It needs two handlers on the same course within seconds, with A stalling across all of B. The result is a stale document until the course next changes. The existing re-index tool (`search-reindex`, #273) repairs it. The window is narrowed by capping the search mapping's concurrency (R-5).

**Alternatives considered**:

- *External versioning.* Rejected above. It may be added later as defence in depth if a spike on a real Serverless collection shows it works (it relates to #270, the index-change work), but nothing here depends on it.
- *FIFO queue with the course id as message group.* Rejected: it keeps per-course order, but it forces a queue fed straight from the stream per feature, and the router sends records, so it would work only for one feature. It also doesn't remove the need to be idempotent.
- *Write the document into a version-checked record in the core table first.* Rejected: a second write path and a new entity for a rare race.

**Progress recalculation**: confirmed order-insensitive. `progressRecalculation` derives the students to recalculate from the records (a completion's student, or everyone enrolled in a course whose visible curriculum changed), then `recalculateStudent` recomputes from the table. Its comment says "Every run recomputes from scratch, so a duplicate stream record or a burst of edits only produces the same result again." One detail to test: `changesWhatStudentsSee` compares a record's old and new image, which are inside one record, so reordering between records can't affect it.

## R-4: Router behaviour, failures and message size

**Decision**:

- The router Lambda's stream mapping keeps today's batch size (100), retries (5) and bisect on error, but uses a 1-second batching window, not today's 5 seconds. The router only routes, and the 5-second window that collapses bursts belongs on each feature queue (R-5); keeping both would stack to about 10 seconds against SC-006's "a few seconds". It has a failure queue the router itself sends to (`StreamRouterFailures`, 14-day retention and the same encryption as the feature queues, switchable per stage like the core table's). The mapping's `onFailure` destination is that same queue, but only for transient errors: for a stream mapping it receives the shard ID and sequence-number range, not the records, so it can't be replayed after the stream's 24-hour retention.
- It sends with `SendMessageBatch` (10 per call) and reports a record in `batchItemFailures` only when the send failed for a transient reason (throttling, a service error), so such a record doesn't repeat the whole batch. A reported record is retried from its sequence number and blocks its shard meanwhile, which is right for a transient error and wrong for one that can never succeed.
- Each queue message body is the stream record, as JSON, in the shape handlers already parse.
- **Size**: the router checks each message's size before sending. A message over the limit isn't sent, and the router does not report it in `batchItemFailures`, because it would fail on every retry and stall every feature on its shard. Instead the router sends a small message to `StreamRouterFailures` (the record's `eventID`, keys, `__edb_e__`, the features whose filters matched, its size and the reason) and returns success for it. That trips the router's alarm. If that send fails, it is a transient error like any other: the record goes in `batchItemFailures` and is retried, so it is never dropped without a trace. The same applies to a record the router cannot route. The record itself isn't kept: it is repaired by `search-reindex` (#273) or the next change to the item, and an operator reads the failure queue to find out which item. No redrive: the queue is for visibility. Today's entities that features read (course, curriculum, item completions) are far smaller than the limit. The SQS limit is 256 KiB in the documentation read here; AWS has announced a larger limit, which was not verified, so the code uses a constant that planning confirms in the first task.

**Confirmed (T002)**: the SQS developer guide's message quotas (docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html) give a maximum message size of 1,048,576 bytes (1 MiB). `MAX_MESSAGE_BYTES` in `packages/events/src/router/queue-client.ts` holds it.

**Why**: it keeps what the existing mappings already do for retries and isolation, and makes the one new failure (an oversized or unroutable record) loud without holding up other features. It does not make that record recoverable, and the spec says so.

**Alternatives considered**: sending keys only and letting handlers re-read (rejected: progress's diff logic needs both images, and keys-only would change two handlers); a larger message through S3 (rejected: nothing today comes near the limit).

## R-5: Handlers behind SQS, and stack placement

**Decision**:

- Each feature handler keeps its logic. A thin adapter turns the SQS event into the stream event shape the handler parses today (`{ Records }`), so `progressRecalculation` and `searchIndexing` change only where stated (search: R-3).
- Each feature's SQS event source mapping sets a batch size of 100 and a 5-second batching window (the SQS mapping supports batching windows up to 300 seconds, with batches over 10 messages when a window is set), so bursts still collapse per course (FR-008).
- The search mapping sets a low maximum concurrency to keep handlers from overlapping (R-3). The mapping's minimum is 2.
- Each feature queue's visibility timeout is at least six times its handler's function timeout, and `maxReceiveCount` is at least 5: both are AWS's guidance for an SQS-triggered Lambda (the Lambda SQS configuration page).
- Retries move from the stream mapping (`retryAttempts: 5`, bisect) to the queue (`maxReceiveCount` 5, then the failure queue). Bisecting a failed batch isn't available on SQS, so one poison message can send its batch-mates to the failure queue as well. That is acceptable here: every handler is idempotent, so redriving the collateral is safe (FR-011, FR-017).
- **Placement**: a new `StreamRouter` stack holds the router Lambda, the feature queues, failure queues, alarms and the handlers' mappings. It moves the progress and search handlers out of `CoreApi`, which leaves room under the 500-resource cap. It depends on `Data` (table, stream, search collection). How it reads AppConfig (progress and search read `RUNTIME_CONFIG_APP_ID`, and `RuntimeConfig` deploys last) is confirmed in the first infra task.
- The router Lambda and any new handler wrapper come from the repo's `ts#lambda-function` generator, like every `events-*` wrapper (constitution II).

## R-6: Visibility and alarms

**Decision**: each feature's failure queue gets one CloudWatch alarm on `ApproximateNumberOfMessagesVisible` greater than 0, with no action attached (spec FR-019). The router's own failure queue gets the same. Queue depth and age metrics for the feature queues come for free and the contributor docs list them.

**Resource cost**: per feature, one queue, one failure queue, one alarm and one mapping (four resources), plus the router's fixed set. Two features plus the router stay well below the cap; the cap check is a task.

## R-7: Cost estimate (FR: Assumptions)

At the sizes in the spec (thousands of changes a day), each part is cents per month: router invocations, SQS requests (the first million a month are free), and alarms ($0.10 each per month, about $0.30 for three). The Pipe path would add Pipe requests ($0.40 per million) and bus events on top. The figures are from AWS pricing pages read during research and aren't a quote.

## Open items carried into tasks

1. ElasticMQ spike (SDK protocol, exact tag string or digest, local redrive), a human task; the version is pinned at 1.7.1. Fallback: the in-process queue.
2. Confirm the SQS message size limit and set the router's constant.
3. Confirm the AppConfig and `RuntimeConfig` wiring for the new stack.
