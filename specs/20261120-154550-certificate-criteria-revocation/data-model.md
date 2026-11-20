# Data Model: Certificate Criteria, What Was Assessed, and Revocation

All in the one core table, through `@discava/core-table`. Reasons are in [research.md](./research.md).

## `course` (existing): `certificateCriteria`

Required map, no default in the entity; nothing reads a missing value as "no criteria".

| Field | Type | Notes |
|-------|------|-------|
| `version` | number, integer ≥ 1 | 1 when the course is created; plus one on every change that alters a value |
| `requireQuizPass` | boolean | `false` on a new course |
| `minUploadScorePercent` | number 1 to 100, optional | Phase 8 only; absent means graded uploads are not required |

`DEFAULT_CERTIFICATE_CRITERIA = { version: 1, requireQuizPass: false }` is written by instructor-api's `course.create` and by every seed, e2e or local-dev helper that writes a `course` (they already write `certificatesEnabled`). After creation the only writer is `setCertificateCriteria` (below). Existing courses are backfilled by hand (tasks T007).

## `certificate` (existing, extended)

| Attribute | Type | Notes |
|-----------|------|-------|
| `assessment` | map, required, read-only | written once by `issueCertificate`; see below |
| `revokedAt` | string (ISO), optional | set while revoked |
| `revocationReason` | `'academic-integrity' \| 'issued-in-error' \| 'other' \| 'refunded'`, optional | set with `revokedAt` |
| `revokedByRole` | `'instructor' \| 'admin'`, optional | set with `revokedAt`; decides who may restore |

`assessment`:

| Field | Type | Present |
|-------|------|---------|
| `criteriaVersion` | number | always |
| `requireQuizPass` | boolean | always |
| `minUploadScorePercent` | number | when that criterion was in force (Phase 8) |
| `itemCount` | number ≥ 1 | always: effectively visible items at issue |
| `assessedItemCount` | number ≥ 0 | always: length of `assessedItems` |
| `assessedItems` | list of `{ contentItemId, kind: 'quiz' \| 'upload', scorePercent, passMarkPercent? }` | always (empty when nothing was required). Internal: no API returns it |
| `passMarkLowest`, `passMarkHighest` | number | when at least one assessed quiz |
| `scoreBand` | 0, 10 … 90 | when `assessedItemCount > 0` |
| `courseHours` | number | when the course stated `durationHours` |

Existing attributes are unchanged: `completedAt` is still the enrolment's, `issuedAt` is when the criteria were met and the record written.

**Indexes** (access patterns, constitution V):

| Pattern | Key | Used by |
|---------|-----|---------|
| A student's certificate for a course; a student's certificates | primary, as today | recalculation, `certificate.pdf`, `certificate.myCertificates`, `certificate.requirements` |
| By certificate ID | `byCertificateId` on `gsi1pk-gsi1sk-index`, as today | `certificate.verify`, instructor and admin revoke, restore and lookup |
| **A course's certificates, newest first** (new) | `byCourse` on the existing `gsi2pk-gsi2sk-index`: `gsi2pk` = `courseId`, `gsi2sk` = `issuedAt`, `userId` | instructor-api `certificate.list` |

No scans in any request. Existing certificate records have neither `assessment` nor the new index keys: they are deleted or rewritten by hand (T007).

## `certificateEvent` (new entity, `entities/certificate-event.ts`)

One record per revocation or restoration. Only ever created.

| Attribute | Type | Notes |
|-----------|------|-------|
| `userId`, `courseId` | string, required | the certificate's key |
| `occurredAt` | string (ISO), required | equals the certificate's `revokedAt` for a `revoked` event |
| `certificateId` | string, required | for reading logs without a join |
| `type` | `'revoked' \| 'restored'`, required | |
| `reason` | as `revocationReason`, required for `revoked` | |
| `note` | string ≤ 500, optional | required when `reason` is `other`; private |
| `actorId` | string, required | Cognito `sub` |
| `actorRole` | `'instructor' \| 'admin'`, required | |

Primary index: pk `userId`, sk `courseId`, `occurredAt`, so a certificate's history is one keyed query, oldest first. No other index.

## State

```text
(none) ──issueCertificate──▶ valid ──revokeCertificate──▶ revoked
                               ▲                              │
                               └──────restoreCertificate──────┘
```

There is no path from `revoked` or `valid` back to none, and `issueCertificate` never writes over an existing record.

## Rules and where they live

`core-table/src/helpers/certificate-criteria.ts` (new):

- `DEFAULT_CERTIFICATE_CRITERIA`.
- `scoreBand(percent)`: `min(90, floor(percent / 10) * 10)`.
- `evaluateCertificateCriteria({ criteria, curriculum, quizSummaries, submissions? })`: pure. Takes the effectively visible curriculum (`filterEffectivelyVisible`); assessed quizzes are visible `quiz` items with `settings.passMarkPercent > 0`. Returns `{ met, requirements, assessment }` where `requirements` is what the course home lists and `assessment` is the map above without `courseHours`.
- `setCertificateCriteria({ coreTable, courseId, criteria })`: reads the course, returns it unchanged if nothing differs, otherwise patches the values with `version + 1`, conditioned on the version it read (a concurrent change makes it retry once).

`core-table/src/helpers/certificate.ts` (existing):

- `issueCertificate` gains `evaluation` and `course.durationHours`. It returns `undefined` unless `evaluation.met`, and writes `assessment` on create. Everything else (existing record returned first, ID collision retries, conditional create, loser reads the winner) is unchanged.
- `revokeCertificate({ coreTable, certificate, actor: { id, role }, reason, note, now })`: one transaction: patch the certificate (`revokedAt`, `revocationReason`, `revokedByRole`) conditioned on `revokedAt` not existing; create the `certificateEvent`. A cancelled transaction reads and returns the stored certificate. Then publishes `certificate.revoked`. Refuses `refunded` from an instructor and `other` without a note.
- `restoreCertificate({ coreTable, certificate, actor, note, now })`: one transaction: remove the three attributes conditioned on `revokedAt` being the value read; create the event. Refuses an instructor when `revokedByRole` is `admin`. Then publishes `certificate.restored`.

These are the only writers of `certificate` and `certificateEvent`. `entity-writers.json` is regenerated in each phase that changes a writer.

## Stream consumers (constitution V)

`PROGRESS_STREAM_FILTERS` (`helpers/progress-stream.ts`) gains `quizSummary` INSERT and MODIFY and `course` MODIFY (Phase 2), and `assignmentSubmission` MODIFY (Phase 8). A quiz pass mark crossing 0 arrives through the existing `contentItem` MODIFY entry and is recognised in the handler. The handler discards records that change nothing relevant (research R-5). The `progress-recalculation` entry in `STREAM_FEATURES` is built from that list, so the deployed router and the local event runner follow.

Checked, with a test each: a `certificate` MODIFY (revocation) and a `certificateEvent` INSERT match no feature's filters; a `course` MODIFY already reaches search indexing, which ignores the new attribute.

## Notification types (`helpers/notification-types.ts`)

| Type | Params | Email | Link |
|------|--------|-------|------|
| `certificate.revoked` | `courseId`, `courseTitle`, `reason` (the category's label) | default on | student portal, `/my-learning` |
| `certificate.restored` | `courseId`, `courseTitle` | default on | student portal, `/my-learning` |

## Invariants

Listed with their rules in research R-10: `certificate-shape` (widened), `certificate-met-criteria` (new), `certificate-status-matches-history` (new), `course-certificate-criteria-shape` (new), `certificate-has-completed-enrolment` (unchanged, new pinning tests).
