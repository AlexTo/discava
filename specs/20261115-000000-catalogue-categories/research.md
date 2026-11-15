# Research: Catalogue Categories, Tags and Richer Filters

No `NEEDS CLARIFICATION` remained after clarify. This records what the codebase showed and the decisions that follow.

## R-1: Where the index and query live today

- **Found**: `packages/databases/search/src/indices/courses.ts` defines `CourseDocumentSchema` and the `courses` mapping (`title` and `description` on the `english` analyzer, `imageKey` unindexed). `syncIndices` creates a missing index or calls `putMapping` on an existing one, both locally (`sync-local-indices.ts`) and deployed (the custom resource). `packages/apis/core-api/src/procedures/search.ts` runs a `cross_fields` `multi_match` filtered to `status: published` with an offset cursor. `packages/events/src/search/course-document.ts` is the one place a course becomes a document, used by the stream indexer and by the re-index Lambda (`search-reindex.ts`, #273).
- **Decision**: extend these in place; no new index.

## R-2: Mapping change and #270

- **Decision**: add only new fields, each a new property. OpenSearch accepts new properties through `putMapping` on an existing index, so `syncIndices` needs no change and the stack does not fail. A unit test on `syncIndices`'s mapping diff (or on the mapping itself) pins that no existing field's type or analyzer changes in this feature.
- **Fields**: `categoryId`, `level`, `language` and `tags` as `keyword` (a keyword field accepts an array, so `tags` needs no special type); `durationHours` as `integer`.
- **Existing documents** lack the fields until the re-index Lambda runs. They remain in text results and appear under no facet value. Run the re-index once after deploy.
- **Alternatives**: wait for #270's versioned index and alias (rejected: this change is additive and #270 is for breaking changes); store the category name in the document (rejected, R-4).

## R-3: Facets with correct counts

- **Decision**: one search request with the text query and `status: published` in `query`, every user filter in `post_filter`, and one `filter` aggregation per facet whose filter is every user filter except that facet's own, holding a `terms` (category, level, language, tags with size 20) or `range` (duration bands) sub-aggregation.
- **Rationale**: this is the standard way to get "count if I picked this instead" facets while the hit list stays fully filtered. Counts are exact because the total hits are small; no approximation applies below the terms aggregation's shard-size limits for a single shard (the index uses one shard).
- **Filter semantics**: values inside a facet use `terms` (OR); facets are `bool.filter` clauses (AND). Tags use `terms` too (a course with any selected tag).
- **Serverless support**: `filter`, `terms` and `range` aggregations and `post_filter` are standard search features available in OpenSearch Serverless search collections. Verified locally by the e2e facet test, which runs against the same engine as the local container.
- **Alternatives**: one request per facet (rejected: N+1 requests against a collection that may be cold); computing counts in the Lambda from all hits (rejected: needs every hit).

## R-4: Category by id, names at read time

- **Decision**: documents store `categoryId` only. When a response is built, core-api reads the category list (one keyed query) and maps ids to name and slug; facet buckets for unknown or archived categories are dropped from the category facet list.
- **Rationale**: a rename or archive touches one record and nothing else: no fan-out re-index of every course in the category, no stale names, no stream filter change. The cost is one extra DynamoDB query per search response, on a partition of at most a few hundred small records.
- **Alternatives**: copy name and slug into each course and into the document (rejected: a rename would need to rewrite every course and its document, a cross-record rule needing its own invariant); cache the category list in the Lambda for 60 s (possible later; not needed now).

## R-5: Taxonomy storage and uniqueness

- **Decision**: entity `category` (pk fixed `category`, sk `categoryId`, a UUIDv7) and entity `categoryClaim` (pk fixed `categoryClaim`, sk `slug#<slug>` or `name#<normalised name>`) in the one table. `categoryWrites` creates a category with both claims in one transaction (each condition: not exists), and renames by creating the new name claim, deleting the old one and patching the category in one transaction. The slug is derived from the name at creation (lower case, hyphenated, ASCII), made unique with a numeric suffix on collision, and never changes.
- **Rationale**: DynamoDB has no unique constraint other than the key; claim records are the standard single-table way, and the transaction makes two admins creating the same name race to one winner (FR-004, US3 scenario 6).
- **Alternatives**: key the category by slug (rejected: a rename would change the key; slug must be immutable but names change, so both must be unique separately); check-then-write (rejected: racy).
- **Listing**: query the `category` partition; no index needed (Constitution V).

## R-6: Setting course fields

- **Decision**: instructor-api `course.updateCatalogue` takes `courseId` and the full set of fields (an omitted field is cleared), checks the caller is an instructor of the course, normalises tags (`normaliseTags` helper in core-table: trim, collapse spaces, lower case, de-duplicate, 1 to 30 characters, at most 8) and writes the course with a condition that its category exists and is active. This is one `core-table` helper (`courseCatalogueWrites`) so any writer enforces the same rule.
- **Archived category kept on a course**: saving without changing the category when it is already archived is allowed (the condition is "active, or equal to the course's current category").
- **Alternatives**: extend `course.create`/`update` (rejected: the existing procedures are about title and description; one new procedure keeps schemas small and the search side's concern in one place).

## R-7: The admin backend

- **Found**: the `admin` Cognito group exists (`user-identity.ts`); local OIDC has Carol as admin; `admin-portal` is a stub page; no API serves admins.
- **Decision**: scaffold `admin-api` with the `ts#trpc-api` generator (Constitution II), with a `protectedProcedure` requiring the `admin` group like instructor-api's requires `instructor`, and connect the admin portal with the `connection` generator. The implementation task consults the generator guide first and records the output. Procedures building on the core table follow instructor-api's hand-written `courseProcedure` plugin pattern, because the `connection` generator does not support tRPC to DynamoDB.
- **Alternatives**: put category management in instructor-api (rejected: instructors are not admins; mixing audiences weakens the group check); put it in core-api (rejected: core-api is for any authenticated user).

## R-8: Shared filter parsing

- **Decision**: parse and serialise filter state to and from URL search params in one module. Only the student portal shows filters, so it lives beside the portal's routes (`student-portal/src/lib/catalogue-filters.ts`); move it to `common-web-utils` only if a second portal needs it (CLAUDE.md: code only one consumer uses stays beside it). The filter type is exported from core-api's schema and reused.

## R-9: Browsing without a query and paging

- **Decision**: `q` becomes optional on `course.publicSearch`. Without it the query is `match_all` (still `status: published`) sorted by `publishedAt` descending then `courseId`; with it, by relevance as today. Paging stays offset-based (`from`) with the same cursor, which is fine for the sizes here. The search box UI keeps requiring text.
- **Alternatives**: a separate `course.browse` procedure (rejected: two near-identical queries and two public operations to keep in sync).

## R-10: Local development and seeding

- **Decision**: `seed-categories` (in `packages/common/scripts`) writes the five placeholder categories through `categoryWrites`, idempotent by name; the existing `e2e:seed-local-courses` target is extended to set catalogue fields. The reindex path locally is the existing `sync-local-indices` plus event runner; the deployed path is #273's Lambda. No new AWS service is introduced, so no new local stand-in.
