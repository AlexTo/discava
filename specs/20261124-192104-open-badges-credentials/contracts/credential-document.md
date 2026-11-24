# Contract: The Credential Document

The JSON file `certificate.credential` returns and the badge image embeds (research R-1, R-6, R-7). `<origin>` is the stage's issuer origin (R-3); `<ID>` the certificate ID as displayed (`XXXX-XXXX-XXXX-XXXX`).

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json"
  ],
  "id": "https://<origin>/certificates/<ID>",
  "type": ["VerifiableCredential", "OpenBadgeCredential"],
  "name": "<course title as recorded>",
  "issuer": {
    "id": "https://<origin>/credentials/issuer",
    "type": ["Profile"],
    "name": "<platform name>",
    "url": "https://<origin>",
    "image": { "id": "<brand icon URL>", "type": "Image" }
  },
  "validFrom": "<certificate.issuedAt>",
  "awardedDate": "<certificate.completedAt>",
  "credentialSubject": {
    "type": ["AchievementSubject"],
    "identifier": [
      { "type": "IdentityObject", "identityType": "name", "hashed": false, "identityHash": "<learnerName>" },
      { "type": "IdentityObject", "identityType": "emailAddress", "hashed": true, "identityHash": "sha256$<hex>", "salt": "<salt>" }
    ],
    "achievement": {
      "id": "urn:uuid:<UUIDv5(issuer id, courseId, criteriaVersion)>",
      "type": ["Achievement"],
      "achievementType": "CertificateOfCompletion",
      "name": "<course title as recorded>",
      "description": "Completed the course <course title>.",
      "criteria": { "narrative": "<assessmentStatement lines, one per line>" }
    }
  },
  "credentialStatus": {
    "id": "https://<origin>/credentials/status/<n>#<index>",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "<index>",
    "statusListCredential": "https://<origin>/credentials/status/<n>"
  },
  "credentialSchema": [{
    "id": "https://purl.imsglobal.org/spec/ob/v3p0/schema/json/ob_v3p0_achievementcredential_schema.json",
    "type": "1EdTechJsonSchemaValidator2019"
  }],
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-rdfc-2022",
    "created": "<time of signing>",
    "verificationMethod": "https://<origin>/credentials/issuer#<keyName>",
    "proofPurpose": "assertionMethod",
    "proofValue": "z…"
  }
}
```

## Rules

- The `emailAddress` identifier is present only when the certificate's `credential` map has a hash (R-6).
- `issuer.image` is the brand icon on the media CDN, or the default Discava icon's public URL.
- Every field except `issuer.name`, `issuer.image` and `proof` is a function of the certificate record and the stage's constants: two downloads differ only in `proof.created` and `proof.proofValue`. A unit test builds the unsigned document twice from one record and compares.
- Never present: the user's `sub`, a readable email, `assessment.assessedItems`, any score, `revocationReason`, `revokedByRole`, notes. A test walks every string in the document for these (SC-005).
- The builder's tests validate the document against the OB 3.0 achievement credential JSON schema (vendored next to the contexts) and verify the proof with `@digitalbazaar/vc` and a fake document loader.

## The issuer profile (`GET /credentials/issuer`)

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json"
  ],
  "id": "https://<origin>/credentials/issuer",
  "type": ["Profile"],
  "name": "<platform name>",
  "url": "https://<origin>",
  "image": { "id": "<brand icon URL>", "type": "Image" },
  "verificationMethod": [{
    "id": "https://<origin>/credentials/issuer#key-1",
    "type": "Multikey",
    "controller": "https://<origin>/credentials/issuer",
    "publicKeyMultibase": "z6Mk…"
  }],
  "assertionMethod": ["https://<origin>/credentials/issuer#key-1"]
}
```

One `verificationMethod` per configured key, oldest first; the `@context` also includes the Multikey/Data Integrity terms if the VC 2.0 context doesn't cover them (checked by the test that verifies against it).

## The status list (`GET /credentials/status/<n>`)

```json
{
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  "id": "https://<origin>/credentials/status/<n>",
  "type": ["VerifiableCredential", "BitstringStatusListCredential"],
  "issuer": "https://<origin>/credentials/issuer",
  "validFrom": "<time served>",
  "credentialSubject": {
    "id": "https://<origin>/credentials/status/<n>#list",
    "type": "BitstringStatusList",
    "statusPurpose": "revocation",
    "encodedList": "u<base64url(gzip(bits))>"
  },
  "proof": { "type": "DataIntegrityProof", "cryptosuite": "eddsa-rdfc-2022", "…": "…" }
}
```

## HTTP (both documents)

- `200` with `Content-Type: application/json`, `Access-Control-Allow-Origin: *`, `X-Content-Type-Options: nosniff`.
- Profile: `Cache-Control: public, max-age=300, s-maxage=3600` (it changes only with the brand or a new key).
- Status list: `Cache-Control: public, max-age=60, s-maxage=240` (the 5-minute budget, SC-003).
- Unknown list number, or a path not listed: `404` with a JSON body `{ "error": "Not found" }` and `Cache-Control: public, max-age=60`.
- `HEAD` answers like `GET` without a body; other methods are refused by CloudFront (`ALLOW_GET_HEAD`).
- Answered for every allowed host; the documents always name the stage's fixed origin, never the request's host.
