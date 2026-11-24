# Contract: core-api Credential Procedures

Two queries on the existing `certificate` router, both `courseProcedure` (signed in) and both on a new dedicated function, `Credentials`, in `CORE_API_DEDICATED_FUNCTIONS`: the only core-api function with `kms:Sign` and `kms:GetPublicKey` on the credential keys, and with the `/<stage>/credentials` parameter.

## `certificate.credential`

**Input**: `{ courseId: string }`

**Output**:

```ts
{
  fileName: string;   // `certificate-<ID>.json`
  credential: string; // the signed document (contracts/credential-document.md), JSON text
}
```

**Behaviour**:

1. Read the caller's certificate for the course (`userId = ctx.user.sub`). None: `NOT_FOUND` (same as another student's course, like `certificatePdf`).
2. Revoked: `PRECONDITION_FAILED`, "This certificate has been revoked".
3. `bindCertificateCredential` (reads the user's email when it binds). A revoke landing meanwhile: `PRECONDITION_FAILED` as in 2.
4. Build the document from the certificate, its `credential` map, the brand and the settings; sign; return.
5. A KMS failure: `INTERNAL_SERVER_ERROR` with "The credential couldn't be created. Try again." and nothing written beyond the binding (which is kept: a retry reuses it).

Writes: at most one bind (certificate patch and status list patch). Never anything else.

## `certificate.badgeImage`

**Input**: `{ courseId: string }`

**Output**: `{ fileName: string /* certificate-<ID>.svg */, svg: string }`

**Behaviour**: steps 1 to 4 as above, then wrap the signed credential in the SVG template (research R-9). The brand icon is read from the public media bucket (`GetObject` on the icon key only) and inlined; if it can't be read, the default icon is used and the error logged.

## `certificate.myCertificates` and `certificate.verify` (existing)

Unchanged in shape. The student portal shows the new actions from `status === 'valid'`, which both already return.

## Tests (per procedure)

- Owner gets a document that verifies; another student, a course with no certificate and an unknown course all get `NOT_FOUND`; a revoked certificate gets `PRECONDITION_FAILED`.
- Two calls return the same document but for `proof.created`/`proofValue`, and bind once.
- A certificate whose user has no email has only the `name` identifier.
- The output contains no `sub`, email, `assessedItems` or score (SC-005).
- Changing any one character of a signed field fails verification (SC-002), over every leaf field.
- `badgeImage`: the SVG parses, its first child is `openbadges:credential`, and the extracted JSON verifies and equals `certificate.credential`'s content.
