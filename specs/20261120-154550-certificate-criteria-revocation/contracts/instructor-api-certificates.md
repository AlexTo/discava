# Contract: instructor-api, criteria and a course's certificates

All use `courseInstructorProcedure` (instructor group plus instructor of `courseId`), so a non-instructor of the course gets what the other course mutations give.

## `course.setCertificateCriteria` (mutation)

Input:

```ts
{
  courseId: string,
  requireQuizPass: boolean,
  minUploadScorePercent?: number | null,   // Phase 8 only: integer 1 to 100; null removes it
}
```

Output: the course as the other course mutations return it, now including `certificateCriteria: { version, requireQuizPass, minUploadScorePercent? }`.

- Calls `setCertificateCriteria` (core-table), then `refreshInstructorCourseUpdatedAt`, like `course.setCertificates`.
- Same values as stored: no write, same `version`.
- Allowed in any course status. Never reads or writes a certificate.
- Until Phase 8 the input schema has no `minUploadScorePercent`; sending it is a validation error.
- The course read procedures the instructor portal uses return `certificateCriteria`.

## `certificate.list` (query)

Input: `{ courseId: string, cursor?: string }`

Output:

```ts
{
  items: Array<{
    certificateId: string,          // display form
    learnerName: string,            // as printed
    completedAt: string,
    issuedAt: string,
    status: 'valid' | 'revoked',
    revokedAt?: string,
    revocationReason?: string,
    revokedByRole?: 'instructor' | 'admin',
    canRestore: boolean,            // false for a valid one, and for one an administrator revoked
  }>,
  nextCursor?: string,
}
```

- One query on `byCourse`, newest first, 50 per page.
- No `userId`, no email.

## `certificate.history` (query)

Input: `{ courseId: string, certificateId: string }`

Output: `Array<{ type: 'revoked' | 'restored', occurredAt, reason?, note?, actorRole, actorName }>`, oldest first. `actorName` is the actor's name from their user record ("An administrator" for role `admin`, so instructors do not learn which administrator).

- The certificate is found by ID and must belong to `courseId`; otherwise `NOT_FOUND`.

## `certificate.revoke` (mutation)

Input:

```ts
{
  courseId: string,
  certificateId: string,
  reason: 'academic-integrity' | 'issued-in-error' | 'other',
  note?: string,   // at most 500 characters; required for 'other'
}
```

Output: the list item, as revoked.

- The certificate must belong to `courseId` (`NOT_FOUND` otherwise, so IDs of other courses are not confirmed).
- Calls `revokeCertificate` with role `instructor`. Already revoked: returns it as stored, no second event.

## `certificate.restore` (mutation)

Input: `{ courseId: string, certificateId: string, note?: string }`

Output: the list item, as valid.

- `FORBIDDEN`, "An administrator revoked this certificate", when `revokedByRole` is `admin`.
- Calls `restoreCertificate`. Already valid: returns it as stored, no event.
