# CLAUDE.md: packages/databases/core-table

Loaded when working in `core-table`. The repo-wide rules are in the root [CLAUDE.md](../../../CLAUDE.md).

Single-table DynamoDB access via ElectroDB; `client.ts` resolves table/client so entities work identically against local (Docker) and deployed DynamoDB.

## Writes

- A write that keeps a rule another API or handler relies on goes in a `core-table` helper every writer calls (e.g. `studentActivityWrites`), with a check in the matching topic file of `helpers/invariants/` (`snapshot.ts` lists the entities it reads); see CONTRIBUTING.md's "Rules That Span Records".
- After changing which code writes the core table, run `pnpm nx run @discava/tooling-agent:entity-writers` and commit the regenerated `core-table/entity-writers.json`; the `Invariant coverage` PR check fails without it.
- Naming: a `*Writes` function returns transaction items for the caller to run; a verb-named function (`issueCertificate`, `publishNotification`, …) runs its own I/O.

## Features

- Course reviews: `reviewWrites` is the only writer of `review` and `courseRating`; ratings are indexed with the course for search, which sorts by a weighted rating.
- Lesson discussions (#280): every write goes through `discussionWrites`, which keeps the counts, accepted answer and queue flags in step. core-api's `discussion` procedures serve students and instructors, instructor-api's `discussion` router the staff queues and moderation.
