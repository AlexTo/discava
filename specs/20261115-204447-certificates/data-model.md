# Data Model: Course Completion Certificates

## `certificate` (new entity, `packages/databases/core-table/src/entities/certificate.ts`)

| Attribute | Type | Notes |
|-----------|------|-------|
| `userId` | string, required | the student (Cognito `sub`) |
| `courseId` | string, required | |
| `certificateId` | string, required, read-only | 16 Crockford base32 chars, no dashes stored; dashes added for display |
| `learnerName` | string, required, read-only | as printed; "Discava learner" if the user record had none |
| `courseTitle` | string, required, read-only | the course's title at issue time |
| `completedAt` | string (ISO), required, read-only | copied from the enrolment |
| `issuedAt` | string (ISO), required, read-only | |
| `createdAt`, `updatedAt` | as other entities | |

**Indexes** (access patterns, constitution V):

| Pattern | Key | Used by |
|---------|-----|---------|
| Get one student's certificate for a course (idempotent issue, owner PDF) | primary: pk `userId`, sk `courseId` | recalculation, `certificate.pdf` |
| List a student's certificates (My Learning) | same primary pk, query on the entity's sk prefix | `certificate.myCertificates` |
| Public verification by ID | existing `gsi1pk-gsi1sk-index`: `gsi1pk` = `certificateId`, `gsi1sk` = constant | `certificate.verify` |

No scans. The table stream sees certificate inserts; they match neither `PROGRESS_STREAM_FILTERS` nor `SEARCH_STREAM_FILTERS`.

## `course` (existing): `certificatesEnabled`

Required boolean (set to `true` on course creation). `true` means on; `false` means off. Existing courses are backfilled by hand (done for local and `discava-development`, see tasks.md T027). Written only by instructor-api's setting procedure, which also moves `updatedAt` like other course edits.

## Rules and where they live

`issueCertificate({ coreTable, enrolment, course, user, now })` in `helpers/certificate.ts`, the only writer of `certificate`:

1. Nothing if the enrolment is not `completed`, is `dropped`, has no `completedAt`, or `course.certificatesEnabled` is `false`.
2. Get the certificate for the student and course; return it if present.
3. Generate an ID; check the ID index for a collision and regenerate (up to 5 tries, then throw).
4. `create` the certificate, `learnerName` from `learnerName(user)`, `courseTitle` from the course, `completedAt` from the enrolment, conditioned on the key not existing. On a conditional failure, read and return the existing one.

## Invariants (`helpers/invariants.ts`, snapshot gains `certificates`)

- `certificate-shape`: ID matches the alphabet and length, is unique across certificates, name, title and both dates are present, `issuedAt >= completedAt`.
- `certificate-has-completed-enrolment`: each certificate has an enrolment for its student and course with status `completed` and the same `completedAt`, and a course record.

Each ships with a test that breaks it. A certificate whose course has certificates off is not a violation (the setting is not retroactive). A completed enrolment with no certificate is not a violation (no backfill, disabled courses).

Existing invariants unaffected: `activity-count-matches-students` and the `student-records-*` checks do not include certificates; a test pins that (a certificate alone does not make a student active).
