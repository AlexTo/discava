# Data Model: Certificates as Open Badges 3.0 Verifiable Credentials

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

All records live in the core table (constitution V). One new entity, one new attribute on `certificate`, no new index.

## `certificate` (existing): gains `credential` and `retiredCredentials`

`credential` is a map, absent until the certificate's credential is first built (research R-5), then unchanged until a revocation moves it into `retiredCredentials`.

| Attribute | Type | Rules |
|-----------|------|-------|
| `credential.statusListNumber` | number | ≥ 1; the `credentialStatusList` it has a bit in |
| `credential.statusListIndex` | number | 0 to 131,071; unique within the list |
| `credential.recipientSalt` | string | 32 hex characters; present with `recipientHash` or neither |
| `credential.recipientHash` | string | `sha256$` + 64 hex characters: SHA-256 of the trimmed, lower-cased email followed by the salt |
| `credential.boundAt` | ISO string | not before `issuedAt` |

| `retiredCredentials` | list of `{ statusListNumber, statusListIndex }` | Places of credentials revoked with the certificate, oldest first; only ever appended to. Their bits stay set for good (research R-4) |

The email itself is never stored on the certificate. `bindCertificateCredential` is the only writer that sets `credential`; `revokeCertificate` is the only writer that removes it (moving its place into `retiredCredentials`).

**State rules**

- Bound only while `revokedAt` is absent (the bind's condition). So a revoked certificate never has a current `credential`.
- `revokeCertificate`, when `credential` is present, sets its bit, removes `credential` and appends its place to `retiredCredentials`, all in the same transaction as the certificate patch, conditioned on the `credential` state it read (R-5).
- `restoreCertificate` writes no status list item and leaves `retiredCredentials` as it is. A bit, once set, is never cleared (`revocation` is not reversible). After a restore, the next download binds a new place.

## `credentialStatusList` (new)

One record per Bitstring Status List.

| Attribute | Type | Rules |
|-----------|------|-------|
| `listNumber` | number | 1, 2, 3… with no gaps |
| `bits` | binary | 16,384 bytes (131,072 bits); bit *i* set ⇔ index *i* is in some certificate's `retiredCredentials`. Never cleared. Bit order as the Bitstring Status List spec defines (index 0 is the most significant bit of byte 0) |
| `assignedCount` | number | 0 to 131,072; the next free index |
| `revision` | number | +1 on every write; every write is conditioned on the revision it read |
| `createdAt`, `updatedAt` | ISO string | standard |

**Keys**: `pk = credentialStatusList`, `sk = <listNumber zero-padded to 6>`. A constant partition holds every list, so the current list is a query on `pk`, descending, limit 1, and a given list is a `get`.

## Access patterns

| # | Pattern | Who | Key / index |
|---|---------|-----|-------------|
| A1 | The caller's certificate for a course | core-api `certificate.credential`, `certificate.badgeImage` | certificate primary (`userId`, `courseId`), as `certificatePdf` |
| A2 | The current status list | `bindCertificateCredential` | `credentialStatusList` primary, `pk` descending, limit 1 |
| A3 | One status list by number | page renderer `/credentials/status/<n>`; revoke | `credentialStatusList` primary `get` |
| A4 | The user's email for the identity hash | `bindCertificateCredential` (via the caller) | `user` primary `get`, existing |
| A5 | The brand for the issuer profile | page renderer `/credentials/issuer` | `getBrand`, existing |

No scan anywhere. The invariant checks read the whole table, as they already do, through `loadTableSnapshot`.

## Transactions

**Bind** (`bindCertificateCredential`): read the certificate; if it has `credential`, return it. If `revokedAt`, throw `CertificateRevokedError`. Read the user (A4) and the current list (A2). In one transaction:

1. `certificate` patch: set `credential`, where `credential` not exists and `revokedAt` not exists;
2. `credentialStatusList` patch: `assignedCount = n + 1`, `revision + 1`, where `revision = r`; or, if the list is full or none exists, create list `n + 1` with `assignedCount = 1`, where it doesn't exist.

On cancel: if item 1 failed, re-read the certificate and return its `credential` (another bind won), or throw if it is now revoked; if only item 2 failed, retry from the read (bounded, then `VersionConflictError`, as `issueCertificate`).

**Revoke** (existing transaction, extended): when the stored certificate has `credential`, add a `credentialStatusList` patch setting its bit, where `revision = r`; extend the certificate patch to remove `credential` and append its place to `retiredCredentials`; and add `credential.statusListIndex = <read value>` (or `credential` not exists) to the certificate patch's condition. On a cancel caused by either new condition, re-read and retry.

**Restore** (existing transaction): unchanged. It writes no status list item and doesn't touch `credential` (absent, since the certificate was revoked) or `retiredCredentials`.

## Stream router

`certificate` records already flow through the stream router (progress, notifications). The new `credential` attribute changes a `certificate` record without changing what any feature reacts to. A task checks each feature's filters against a `credential`-only modify and adds that case to `stream-features.test.ts`. `credentialStatusList` records are routed to no feature; the same test asserts it.

## Invariants

See research R-10: `credential-status-matches-certificate` (a bit is set exactly when its place is retired), `credential-status-index-unique` (over current and retired places), `credential-status-list-shape`, and the `credential` and `retiredCredentials` rules added to `certificate-shape`. `credentialStatusList` is added to `TableSnapshot` and `SNAPSHOT_ENTITIES`.
