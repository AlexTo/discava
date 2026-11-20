# Contract: admin-api `certificate` router

All use `adminProcedure`, as the review moderation procedures do.

## `certificate.get` (query)

Input: `{ certificateId: string }` (any case, with or without dashes)

Output:

```ts
{
  certificateId: string,            // display form
  learnerName: string,
  courseId: string,
  courseTitle: string,              // as printed
  completedAt: string,
  issuedAt: string,
  statement: string[],              // as the public page prints it
  status: 'valid' | 'revoked',
  revokedAt?: string,
  revocationReason?: string,
  revokedByRole?: 'instructor' | 'admin',
  history: Array<{ type, occurredAt, reason?, note?, actorRole, actorName }>,
}
```

- Normalises the ID as `certificate.verify` does; malformed or unknown: `NOT_FOUND`.
- Two keyed reads: the certificate by ID, then its events.

## `certificate.revoke` (mutation)

Input: `{ certificateId: string, reason: 'academic-integrity' | 'issued-in-error' | 'other' | 'refunded', note?: string }`

Output: as `certificate.get`.

- Calls `revokeCertificate` with role `admin`. `refunded` is accepted here and nowhere else. `other` needs a note.
- Does not look at orders: choosing `refunded` is the administrator's statement, not a check (research R-8).

## `certificate.restore` (mutation)

Input: `{ certificateId: string, note?: string }`

Output: as `certificate.get`.

- Restores whoever revoked it.

There is no admin listing of all certificates (out of scope).
