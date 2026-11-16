# Feature Specification: Core Table Stream Event Router

**Feature Branch**: `20261116-183449-stream-event-router`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "Stream event router for the core table. Move the core table's DynamoDB stream behind ONE stream consumer with a filter rule, queue and dead-letter queue per feature, so the stream never exceeds two consumers per shard. Refactor the two existing consumers (progress recalculation and search indexing) onto it, behaviour-preserving, and make search indexing order-safe, because the queues do not keep per-item order. Define the per-feature pattern that notifications (#331) and the instructor dashboard (#332) will adopt, with a local-dev stand-in that routes the same filters to the same handlers."

**Parent issue**: none

## Clarifications

### Session 2026-11-16

- Q: When a course record is permanently removed, what version does the search index use for the removal? → A: The removed record's last-updated time plus one millisecond. It comes from the record itself, so it is the same on every delivery and retry, and it beats every earlier edit. No second clock is involved.
- Q: How does an operator send work from a failure destination back to its handler once the cause is fixed? → A: A documented manual step using the queue service's own redrive, with no new tool. A test shows that a redriven change gives the same result as its first delivery. A script or automatic redrive can be added later if needed.
- Q: How does an operator find out a feature's failure destination has work in it? → A: One alarm per failure destination that enters the alarm state whenever the destination holds anything, visible in the console, with no notification target. A notification channel can be added later.
- Q: If a course change arrives with no usable last-updated time, does search apply it or refuse it? → A: Refuse it. The handler fails that change, so after its retries it ends in the search failure destination, where the alarm shows it and it can be redriven once the record is fixed.
- Q: Does this spec's pull request also edit the notifications (#331) and dashboard (#332) specs? → A: No. This PR touches only its own spec folder (and the constitution and contributor-doc wording in FR-024). #331 and #332 are each updated afterwards on their own PRs, and this PR's description lists what each must change.

## User Scenarios & Testing *(mandatory)*

The "users" of this feature are the contributors and agents who build features that react to changes in the core table, and the operators who run the deployed stage. Learners, instructors and admins should see no change at all, other than staying correct when changes arrive in an unexpected order. Today two features consume the core table's change stream directly (progress recalculation and search indexing). That is the most a stream shard should have, and two open specs (notifications #331, instructor dashboard #332) each want another. This feature puts one router in front of the stream so any number of features can react to changes, and moves the two existing consumers onto it first.

### User Story 1 - Add a feature that reacts to table changes without touching the stream limit (Priority: P1)

A contributor building a feature that must react to changes (sending a notification, updating an aggregate) declares three things: which records it cares about, a queue-backed handler, and a failure destination. They do not attach anything new to the table's change stream, and the count of consumers on the stream stays the same however many features exist.

**Why this priority**: This is the reason for the feature. Without it, notifications and the dashboard cannot both ship, and every later feature repeats the problem.

**Independent Test**: Add a throwaway third feature in a test that declares its record filter and handler. Check it receives only the matching changes, and check the stream's consumer count is unchanged.

**Acceptance Scenarios**:

1. **Given** the router with progress and search registered, **When** a third feature registers its record filter and handler, **Then** it receives the changes matching its filter and nothing else, and no additional consumer is attached to the stream.
2. **Given** a change matching two features' filters, **When** it is routed, **Then** each of the two features receives its own copy independently, and a failure in one does not delay or lose the other's.
3. **Given** a change matching no feature's filter, **When** it is routed, **Then** no handler runs and nothing is queued.
4. **Given** the documented pattern, **When** a contributor follows it to add a feature, **Then** they change only that feature's registration, filter and handler, not the router itself.

---

### User Story 2 - Progress and search behave exactly as before (Priority: P1)

Learners still see their progress recalculated after a lesson changes, and the course search still reflects publishing, editing and unpublishing, after both existing consumers are moved behind the router. No existing test is weakened to make this pass.

**Why this priority**: The refactor is only acceptable if nothing a user can see changes. It lands before any new feature depends on the router.

**Independent Test**: Run the existing progress and search tests and end-to-end scenarios unchanged against the router. They pass.

**Acceptance Scenarios**:

1. **Given** a student completes a content item, **When** the change is routed, **Then** their course progress is recalculated as it is today.
2. **Given** an instructor publishes, edits or unpublishes a course, **When** the change is routed, **Then** the search results reflect it as they do today.
3. **Given** bursts of edits (an instructor publishing a module), **When** they are routed, **Then** each affected course is still recalculated once for the burst rather than once per edit.
4. **Given** the router is deployed, **When** the stream is inspected, **Then** it has exactly one consumer.

---

### User Story 3 - Search stays correct when changes arrive out of order (Priority: P1)

A course that is published and then unpublished a moment later is not left searchable, even when the two changes reach the search handler in the opposite order. The router does not guarantee per-record order, so the search handler decides on its own whether a change is newer than what it has already applied.

**Why this priority**: Moving behind a queue removes an ordering guarantee the search handler silently relied on. Without this, an unpublished course can stay in search results until it is next edited.

**Independent Test**: Deliver an older "published" change after a newer "unpublished" change for the same course and check the course is not in the index. Repeat for edit, then older edit, and for delete then older edit.

**Acceptance Scenarios**:

1. **Given** a course was unpublished, **When** an older published change for it is delivered afterwards, **Then** the course stays out of search results.
2. **Given** a course was edited twice, **When** the older edit is delivered last, **Then** the index keeps the newer title and description.
3. **Given** a course was deleted, **When** an older change for it is delivered afterwards, **Then** the course does not reappear.
4. **Given** the same change is delivered twice, **When** it is applied, **Then** the result is identical to applying it once.
5. **Given** the progress handler receives changes in any order or more than once, **When** it runs, **Then** the result is the same, because it recomputes from current data.

---

### User Story 4 - Failures are contained and visible per feature (Priority: P2)

When one feature's handler keeps failing, its failed work is set aside in that feature's own failure destination, where an operator can see what failed, while other features keep running and the stream keeps moving.

**Why this priority**: Isolation and visibility are what make a shared router safe to build on, but the feature delivers value without them being polished.

**Independent Test**: Make one registered handler fail permanently and check its failures land in its own failure destination, the other feature still processes its changes, and nothing is blocked.

**Acceptance Scenarios**:

1. **Given** one feature's handler keeps failing, **When** retries are exhausted, **Then** the failed work lands in that feature's own failure destination and no other feature's destination.
2. **Given** a failing handler, **When** other features' changes arrive, **Then** they are processed normally.
3. **Given** work in a failure destination, **When** the cause is fixed, **Then** it can be replayed to the same handler.
4. **Given** the existing progress and search failure destinations, **When** they move behind the router, **Then** each feature keeps its own, with the same retention.

---

### User Story 5 - The whole thing runs locally with no AWS account (Priority: P2)

A contributor running the local stack sees the same routing: a change to the local table reaches the same handlers through the same filters, and the local router uses the same registrations as the deployed one, so a filter that is wrong fails locally too.

**Why this priority**: The project requires every feature to run locally. It follows the router itself, and local development is not usable for the new features without it.

**Independent Test**: Run the event runner's tests and the end-to-end scenarios and check progress and search still update locally, and a registration with a wrong filter fails a test.

**Acceptance Scenarios**:

1. **Given** the local stack, **When** a lesson or course changes, **Then** progress and search update through the local router with no AWS account.
2. **Given** a feature's registration, **When** it is read by both the deployed and the local router, **Then** both route the same changes to the same handler.
3. **Given** a registration that names a handler that does not exist, or a filter that matches nothing, **When** tests run, **Then** they fail.

---

### Edge Cases

- A change matches no registration (most writes today): nothing runs and no queue message is produced.
- A change matches several registrations: each gets its own copy.
- The router itself is down or throttled: changes wait on the stream and are routed afterwards, in the stream's order, with no loss within the stream's retention.
- A handler is slower than the arrival rate: its queue grows without affecting other features or the stream.
- A burst of changes to one course: still collapses into one recalculation per course per batch.
- A poison message (a change a handler can never process): ends in that feature's failure destination, and does not retry forever or block later changes.
- A change delivered twice (at-least-once delivery): every handler must be safe to run twice with the same input.
- A change delivered much later than it happened: handlers that write state from the change itself (search) must not overwrite newer state with it.
- A record with no `updatedAt` (or one that isn't a valid time): search refuses it (FR-015), so it lands in the failure destination and trips the alarm rather than being applied unchecked or dropped.
- Two writes to one course within the same millisecond (equal versions): the second is not newer than the first, so it is ignored by the version check. Planning decides whether the handler needs more than the last-updated time to avoid losing the second.
- A course removed and an older edit for it delivered afterwards: the removal's version (last-updated time plus one millisecond) is higher, so the edit is ignored and the course stays out.
- Local router and deployed router disagree on a filter: prevented by one shared registration, checked in tests.

## Requirements *(mandatory)*

### Functional Requirements

**Routing**

- **FR-001**: The core table's change stream MUST have exactly one consumer, the router. No feature may attach its own consumer to the stream.
- **FR-002**: The router MUST send each change to every feature whose filter matches it, and to no other feature. Each matching feature MUST receive its own independent copy.
- **FR-003**: Each feature MUST have its own queue, failure destination, retry settings and handler, so that one feature's failures or backlog do not affect another's.
- **FR-004**: A feature's registration MUST be one declaration naming its record filter, handler, batching and retry settings, read by both the deployed router and the local router.
- **FR-005**: Adding a feature MUST NOT require changing the router's own code or the stream's configuration.
- **FR-006**: Routing MUST preserve what each handler needs from a change (event kind, old and new images, keys, the approximate time of the change), so a handler written for the stream receives the same information.

**Moving the existing consumers**

- **FR-007**: Progress recalculation and search indexing MUST be moved behind the router with the same filters as today, so each receives the same changes it receives now.
- **FR-008**: Burst collapsing MUST be kept: a burst of changes for one course is handled in batches so each course is recalculated once per batch.
- **FR-009**: The existing tests and end-to-end scenarios for progress and search MUST pass unchanged. A test change is allowed only where a task names the behaviour that justifies it.
- **FR-010**: There MUST be no compatibility layer: the old direct stream consumers and their failure destinations are removed in the same change that adds the router, not kept alongside.

**Ordering and duplicates**

- **FR-011**: Every handler MUST be safe to run more than once with the same change and with changes in any order. The router does not guarantee per-record order or exactly-once delivery.
- **FR-012**: Search indexing MUST NOT let an older change overwrite a newer one. It MUST compare each change's version (taken from the course's own last-updated time) with what the index already holds and ignore a change that is not newer, including for removals.
- **FR-013**: A removal in the search index MUST be recorded as versioned too, so that a later-arriving older change cannot bring a removed course back. The removal's version is the removed record's last-updated time plus one millisecond, so it is derived from the record alone and is identical on every delivery.
- **FR-014**: Progress recalculation MUST continue to recompute from current data on every run, and a test MUST show that duplicate and reordered deliveries give the same result.
- **FR-015**: A course change that carries no usable version (no last-updated time, or one that isn't a valid time) MUST be refused: the search handler fails that change, so after its retries it ends in the search failure destination. It MUST NOT be applied without a version check and MUST NOT be skipped silently. A test covers it.

**Failures**

- **FR-016**: A change that still fails after a feature's retries MUST be set aside in that feature's own failure destination, with enough information to identify the change and the handler, and MUST NOT block later changes.
- **FR-017**: Failed work MUST be replayable to the same handler after the cause is fixed, by a documented manual redrive from the feature's failure destination using the queue service's own redrive. No replay tool is built in this feature. Replay MUST be safe, by FR-011, and a test MUST show that a redriven change gives the same result as its first delivery.
- **FR-018**: Failure destinations MUST keep the retention and encryption settings the existing ones have, unless the plan justifies a change.
- **FR-019**: Each feature's failure destination MUST have one alarm that enters the alarm state whenever the destination holds any work, visible in the console. No notification target is attached in this feature. Operators can also see, per feature, how many changes are waiting through the queue's built-in depth and age metrics, which the contributor docs list per feature. The alarm is part of the per-feature pattern, so each new feature gets one.

**Local development**

- **FR-020**: The local event runner MUST route changes to the same handlers using the same registrations and filters as the deployed router, with no AWS account.
- **FR-021**: The local router MUST keep the behaviour local development has today (batching window, batch size, per-feature failure handling) so progress and search work as they do now.
- **FR-022**: A registration naming a missing handler, or whose filter is invalid, MUST fail a test rather than silently route nothing.

**Pattern and documentation**

- **FR-023**: The feature MUST document the per-feature pattern (registration, filter, queue, failure destination, handler, ordering rules, local behaviour) in the repository's contributor documentation, in enough detail that notifications (#331) and the dashboard (#332) can adopt it without asking.
- **FR-024**: The contributor documentation and the project constitution's stream-consumer wording (which today names progress and search) MUST be updated to describe routing through the router.
- **FR-025**: The notifications (#331) and instructor dashboard (#332) specs MUST adopt the router in place of a direct stream consumer. Each is updated on its own pull request after this spec is approved, not in this one. This pull request's description MUST list what each must change: the registration, filter, queue, failure destination and alarm it takes from the pattern, and, for #332, the ordering and duplicate-delivery handling its aggregates need.

### Key Entities

- **Stream router**: the single consumer of the core table's change stream. It holds no business logic. It only decides which features get which changes.
- **Feature registration**: one declaration per feature: its name, the changes it cares about (a filter on event kind and record type), its handler, its batching and retry settings. The deployed router and the local router both read it.
- **Feature queue**: the buffer between the router and one feature's handler. It absorbs bursts and lets the handler retry on its own.
- **Failure destination**: one per feature, where work that exhausted its retries is kept for inspection and replay.
- **Change**: one record from the stream: event kind, keys, old and new images, approximate time. It is the unit the router sends on.
- **Version (search)**: the course's own last-updated time, used to refuse an older change after a newer one.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The core table's stream has exactly one consumer after the change, and still has one after a third and fourth feature are added.
- **SC-002**: Adding a feature takes one registration, one handler and its tests, with zero edits to the router's own code.
- **SC-003**: 100% of the existing progress and search unit tests and end-to-end scenarios pass unchanged, and no test is weakened.
- **SC-004**: Delivering any pair of search changes for a course in the wrong order, or twice, leaves the index identical to delivering them once in the right order, across every order tested.
- **SC-005**: A feature whose handler fails permanently has its failures in its own failure destination, and the other features' processing continues within their normal delay.
- **SC-006**: A learner's progress and a course's search result reflect a change within the same delay as today, plus no more than a few seconds for the router.
- **SC-007**: Local development gives the same routing as deployed, with no AWS account, and a wrong filter or missing handler fails a test.
- **SC-008**: Two open specs (#331, #332) can each adopt the router with no change to the router itself.

## Assumptions

- Discava has not launched, so the existing consumers are replaced outright with no migration, dual-running or compatibility layer (constitution principle VII). Existing development data is fixed by hand if needed.
- The stream's own ordering guarantee is what the handlers rely on today. Moving behind queues removes it, and this feature accepts that and makes handlers order-safe rather than paying for ordered queues.
- Progress recalculation already recomputes from current data on every run, as its existing infrastructure comment states. This is to be confirmed against the handler in planning.
- Search indexing today builds its document from the stream record and writes it without comparing versions, so it is the one handler that must change.
- Course records carry a last-updated time that moves forward on every write that changes what search shows, including unpublishing. The course entity already sets it on every write (it watches all attributes), so no change to the record is expected. Planning confirms that no write path bypasses the entity.
- One stream consumer feeding a shared event bus, with per-feature rules and queues, is the intended shape. The exact mechanism for the single consumer (a managed pipe or a small router function) is decided in research, based on local-dev fit, filtering power and cost.
- The notifications (#331) and dashboard (#332) specs are in review. They are updated to use the router on their own pull requests after this spec is approved, and are not changed in this one (FR-025).
- A few seconds of added delay between a table change and a handler running is acceptable for every current and planned consumer.
- At current scale the cost of the bus and queues is negligible. Planning records the estimate.
- Out of scope: changing what progress or search compute, moving non-stream events (media transcodes, identity triggers) onto the router, ordered (first-in-first-out) delivery, and any consumer other than progress and search in this change.
