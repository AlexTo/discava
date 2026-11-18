# Research: Course Ratings and Written Reviews

## R-1: Where the aggregate lives

**Decision**: A separate `courseRating` record per course (key: course; sort key a constant), holding `stars1` to `stars5`.

**Rationale**: `course.updatedAt` moves on every write to the record (`watch: '*'`) and the `instructor-course-updated-at` invariant requires each instructor's `courseUpdatedAt` to equal it, so a counter on `course` would break that rule and force instructor-list updates on every vote. It would also make every vote a `course` MODIFY, re-indexing the course for search and waking nothing else useful. Five counters make count, total and average derivable (`count = sum(stars)`, `average = sum(n x stars_n) / count`), so there is no separate sum and count to drift.

**Alternatives**: `ratingSum` and `ratingCount` on `course` (breaks the invariant above); computing the average by querying all reviews on each read (a query per card, unbounded); a single `ratingSum`/`ratingCount` on a separate record (no star breakdown, which the page needs, and two numbers that can disagree).

## R-2: One review per student, under concurrency

**Decision**: `review` primary key is course + student. `post` is a transaction of a `review` create conditioned on not-exists, an `enrolment` condition check (status not `dropped`), a `course` condition check (status `published`) and the `courseRating` increment.

**Rationale**: a key makes uniqueness a storage rule rather than a read-then-write race; the same shape protects `assignmentSubmission` and `certificate`. Putting the counter in the same transaction means a cancelled create never increments.

**Alternatives**: a unique-lock record (a second write for nothing the key does not give); check-then-put (racy).

## R-3: Listing a course's reviews newest first

**Decision**: index `byCourse` on the existing `gsi2pk-gsi2sk-index`: `gsi2pk` composite `courseId`, `gsi2sk` composite `createdAt`, `userId`.

**Rationale**: constitution V requires a named pattern per index and no new index without need. `gsi2` is used only by `assignmentSubmission.byUser`; ElectroDB prefixes each entity's key values, so they stay apart (risk R2, proven with `.params()`). `createdAt` is read-only, so an edit never rewrites an index key.

**Alternatives**: sort key `createdAt` on the primary index (loses key-enforced uniqueness per student); a new GSI (more write cost for one pattern); sorting by "most helpful" (out of scope).

## R-4: Edits, deletes, removal and responses

**Decision**: Edit, delete and admin removal are conditioned on `version = <read>` and `status = visible`. A response patches `responseText`, `responseAt`, `responseById`, `responseByName` with a `courseInstructor` condition check and a `status = visible` condition, and does not change `version`.

**Rationale**: the student's optimistic edit must fail rather than overwrite a concurrent change (FR-002), but an instructor's response must not make the student's next edit fail, and DynamoDB updates to different attributes do not lose each other. A removal that loses to an edit re-reads and retries, so removal always ends up applied; an edit that loses to a removal is refused.

**Alternatives**: a separate `reviewResponse` entity (a second record per review, a join on every list); bumping `version` on a response (spurious conflicts for students).

## R-5: Search document and the indexer

**Decision**: `toCourseDocument` takes the course and its optional `courseRating` and adds `ratingCount`, `ratingAverage`, `ratingScore` and `ratingBoost`. The search-indexing handler (behind the stream event router's queue) takes the distinct course ids from `course` and `courseRating` records, reads each course by key and, when published, its `courseRating` by key (both consistent), and indexes or deletes as it is now. `SEARCH_STREAM_FILTERS` gains `courseRating` for INSERT and MODIFY, which routes those records to `search-indexing` through `featuresFor`. The re-index function batch-gets ratings for the courses it rebuilds.

**Rationale**: the indexer replaces the whole document (`client.index`), so partial updates from two sources would overwrite each other. Rebuilding from fresh reads makes each event idempotent and order-insensitive: the queue may deliver out of order (`maxConcurrency: 2`), but every batch indexes what the table holds when it reads. The one accepted race is the router spec's: two batches for one course running at the same moment can each read, then write in the other order, leaving an older document until the next change to that course or a re-index. This is the same narrow overlap the stream event router spec accepts for search. The weighted score and boost are computed once at index time so the query needs no script (`function_score` with `field_value_factor` on a stored number).

**Alternatives**: OpenSearch partial `update` for ratings (then a later course `index` loses them unless every course event also carries them: same reads, more moving parts); ranking by a script computed per query (cost on every search, unnecessary).

## R-6: Weighted rating and boost

**Decision**: `ratingScore = (count x average + PRIOR_WEIGHT x PRIOR_MEAN) / (count + PRIOR_WEIGHT)`, with `PRIOR_WEIGHT = 5` and `PRIOR_MEAN = 3.5` defined once in `helpers/review-rating.ts` (tuning them needs a re-index); for ordering by rating, sort by `ratingScore` descending, unrated last, then newest. For relevance, multiply the text score by `ratingBoost = 1 + 0.1 x (ratingScore - 3.5)`, which stays within (0.75, 1.15) (ratingScore lies strictly between 1 and 5, so ten 1-star ratings give about 0.833 and no tally reaches 0.75 or 1.15) and is `1` for unrated courses. There is no clamp.

**Rationale**: a Bayesian average with a prior of five ratings at 3.5 keeps one 5-star rating (3.75) below a course with twenty 4.5 ratings (4.3) while still moving courses with a handful of good ratings up. The boost is modest so text relevance still dominates; unrated courses are neither promoted nor penalised relative to a middling course.

**Alternatives**: plain average (one vote wins); Wilson lower bound (better statistics for binary votes, harder to explain for star ratings); a larger boost (burying relevant but unrated new courses).

## R-7: Admin backend

**Decision**: Use the `admin-api` that the catalogue categories plan (#333) scaffolds with the `ts#trpc-api` generator and connects to the admin portal with `connection`. If it is not on `main` when this feature's admin phase starts, that phase runs the same generators (consulting `generator-guide`, recording what they produced) and #333 reuses the result.

**Rationale**: constitution II (generators first) and one admin backend, not two. The admin group check is the generated API's; this feature adds procedures only.

**Alternatives**: an `admin`-group procedure in core-api (mixes admin operations into the public-facing shared Lambda and a different authorisation model; the repo already separates instructor-api for the same reason); a second admin API for reviews (duplicates infrastructure).

## R-8: Cards and the course list

**Decision**: `course.publicList` batch-gets the returned page's `courseRating` keys (at most 100) and adds `ratingAverage` and `ratingCount`; search hits read both from the document.

**Rationale**: one batch read per page rather than a read per card (FR-006, SC-006).

**Alternatives**: store the rating on the course (R-1); the portal calling a rating endpoint per card (N requests).

## R-9: Reviewer display name and privacy

**Decision**: `reviewerName` is snapshotted at post time: given name plus the first letter of the family name and a full stop ("Alex T."), "Discava learner" if neither exists. Public responses never include `userId` or email; instructor and admin responses include `reviewerId` because they act on a review.

**Rationale**: a short name limits exposure while still reading as a person, and snapshotting means later edits to the user cannot rewrite a public review. The user ID is a Cognito `sub`, not a secret, but the public API has no need for it.

**Alternatives**: full name (more exposure than the issue needs); anonymous (less trust); reading the live user record on each list (an extra batch read per page and names changing under a review).

## R-10: Text

**Decision**: plain text, up to 2,000 characters after trimming; whitespace-only becomes no text; the portals render it as text (React escapes it), preserving line breaks.

**Alternatives**: rich text (the instructor editor is heavy and an injection surface for public content).

## R-11: Notifications

**Decision**: `review.received` (already in #331's registry) is published to each instructor of the course inside the create transaction using `notificationWrites`, with `dedupeKey = <courseId>:<studentId>` and `occurredAt = createdAt`. The registry's instructor path for the type, `/my-courses` in #331's table, is changed to `/my-courses/<courseId>/reviews` by a task in this feature once both exist.

**Rationale**: the contract says producers add the helper's items to their own transaction; a duplicate publish cancels on the notification create. The instructor list is read before the transaction (few per course; the 100-item transaction cap is not at risk). Edits and deletes publish nothing.

**Alternatives**: `publishNotification` after commit (a failure between loses the notification); notifying on every edit (noise).
