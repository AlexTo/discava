# Research: Certificates as Open Badges 3.0 Verifiable Credentials

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-11-24

Sources read on 2026-11-24: the Open Badges 3.0 specification (1EdTech, document 1.4.5, 29 June 2026, <https://www.imsglobal.org/spec/ob/v3p0/>), its implementation guide (<https://www.imsglobal.org/spec/ob/v3p0/impl/>) and certification guide (document 1.5, <https://www.imsglobal.org/spec/ob/v3p0/cert/>); the AWS KMS developer guide and `Sign` API reference; the READMEs of the 1EdTech public validator, DCC `verifier-core` and the VerifierPlus FAQ. Section numbers below are the specification's.

## R-1: Proof format: embedded Data Integrity proof, `eddsa-rdfc-2022`

**Decision**: Sign each credential with an embedded `DataIntegrityProof` using the `eddsa-rdfc-2022` cryptosuite (Ed25519 over the RDF-canonicalised document), and deliver it as a JSON file. No VC-JWT.

**Rationale**:

- The certification guide (§3.1.1) lists only Data Integrity suites for issuers (`eddsa-rdfc-2022`, `ecdsa-sd-2023`). The implementation guide also mentions RS256 JWTs, but the certification guide doesn't, so a JWT-only issuer may not certify.
- VC-JWT requires `sub` to equal `credentialSubject.id` (§8.2). Our learners have no wallet identifier (spec clarification 2), so the subject has no `id`, only `identifier`s. Data Integrity has no such rule.
- The free verifiers the spec's success criteria lean on (the 1EdTech validator, DCC `verifier-core`, VerifierPlus) document Data Integrity with EdDSA; none documents VC-JWT.
- A JSON document with an embedded proof is also what the PNG and SVG baking rules expect for Data Integrity (§5.3), so the badge image (Story 4) embeds the same file.

**Alternatives considered**: RS256 VC-JWT (the spec's "minimum" for JWT, widest JOSE support, but the subject `id` problem and no certification path); ES256 VC-JWT (allowed, "limits interoperability"); `ecdsa-rdfc-2019` on a P-256 KMS key (works in DCC's verifier, not listed in the certification guide); issuing both a JWT and a Data Integrity copy (twice the surface for no named verifier that needs the JWT). A JWT can be added later from the same builder if a consumer asks.

## R-2: The signing key: an Ed25519 key in AWS KMS

**Decision**: One asymmetric KMS key per stage, key spec `ECC_NIST_EDWARDS25519`, usage `SIGN_VERIFY`, signing with `ED25519_SHA_512` and `MessageType: RAW`. It is created in the `Data` stack (it is stateful) with `RemovalPolicy.RETAIN`, behind an alias `alias/<stage>/credential-signing/<keyName>`. `kms:Sign` is granted to two roles only: core-api's new dedicated `Credentials` function and the page renderer (which signs status lists, R-4). `kms:GetPublicKey` is granted to the same two.

**Rationale**:

- KMS supports Ed25519 (`ECC_NIST_EDWARDS25519`). `ED25519_SHA_512` takes `MessageType: RAW` (up to 4096 bytes), and `eddsa-rdfc-2022` signs the 64-byte concatenation of two SHA-256 hashes, well inside it. The implementation guide's note that "cloud KMSs are largely not yet compatible with Ed25519" (§3.1.2) predates this. `aws-cdk-lib` already in the repo has `KeySpec.ECC_NIST_EDWARDS25519`.
- The private key never leaves KMS (FR-014), and each stage gets its own (FR-015). This fits constitution I (managed, serverless) and VI (hardened by default: no exportable key material, key policy limited to the two roles).
- The AWS docs don't state the signature's byte encoding for Ed25519. Standard Ed25519 signatures are 64 raw bytes, and a unit test with a recorded KMS response plus a `(human)` check on `discava-development` confirm it before the MVP merges.

**Rotation (FR-013)**: KMS doesn't rotate asymmetric keys. Rotation is adding a second key: the construct takes a list of key names (default `['key-1']`), the last is current, and every listed key stays published in the issuer profile. Removing a key from the list is the only way to stop publishing it, and the deploy docs say not to while its credentials are in use. The CDK resource is retained even if removed, so a mistaken removal is undone by adding it back.

**Alternatives considered**: a key in Secrets Manager signed with `node:crypto` (the private key would be readable by the function's role and appear in memory, against FR-014); a P-256 KMS key with `ecdsa-rdfc-2019` (see R-1); one key shared across stages (against FR-015).

## R-3: Who the issuer is and where it answers

**Decision**:

- The issuer `id` is an HTTPS URL on the student portal's public origin: `https://<origin>/credentials/issuer`. That URL answers with the issuer `Profile` (name, url, image, email absent), which is also the controller document for the keys: `verificationMethod` lists one `Multikey` per key (`id` `https://<origin>/credentials/issuer#<keyName>`, `controller` the issuer `id`, `publicKeyMultibase` the Ed25519 public key as `z6Mk…`) and `assertionMethod` lists their ids (implementation guide §3.1.12.1).
- `<origin>` is the stage's first `studentPortal.domainNames` entry when it has one, otherwise the distribution's CloudFront domain. It is fixed per stage and written, with the key list, to a new SSM parameter `/<stage>/credentials` in the `Data` stack beside `/<stage>/page-renderer` (the `Data` stack already depends on the `Websites` stack, so it can read the distribution's domain). Core-api's `Credentials` function and the page renderer read it once per container, as `resolvePageRendererSettings` does.
- The name is the platform brand name (`getBrand`, Branding page), the image the brand icon on the media CDN, or the default Discava icon. These are read when the profile is served, so a renamed platform shows its new name to verifiers (spec edge case).
- `/credentials/*` is added to the student portal's page-renderer paths, so the profile and the status lists (R-4) are served by the page renderer through CloudFront, signed out, with `Access-Control-Allow-Origin: *` (browser-based verifiers such as VerifierPlus fetch cross-origin) and `Content-Type: application/json`.
- Locally, `<origin>` is the local page renderer (`LOCAL_PAGE_RENDERER_URL`, `http://localhost:2026`), which already serves `/certificates/*` and gains `/credentials/*`.

**Rationale**: HTTP URLs are the only key-resolution form verifiers must support (§8.5); a DID is optional. Serving from the page renderer reuses the existing public, cached, path-keyed CloudFront behaviour and its host allow-list; no new Lambda or API.

**Alternatives considered**: `did:web:<origin>` (VerifierPlus documents did:web or did:key and an issuer registry; registering is an outside process, left for later and noted in the plan's risks); the core-api API Gateway domain as the issuer (an API address, not the platform's public address, and differs per API); the request's host as the origin (a credential's issuer must not depend on which allowed host a request came through).

## R-4: Revocation: Bitstring Status List, bits written with the revoke

**Decision**:

- Each credential carries `credentialStatus: { id: "<listUrl>#<index>", type: "BitstringStatusListEntry", statusPurpose: "revocation", statusListIndex: "<index>", statusListCredential: "<listUrl>" }`, where `<listUrl>` is `https://<origin>/credentials/status/<listNumber>`.
- The list is a new core-table record, `credentialStatusList`, one per list: its bits (131,072 entries, 16 KB, the minimum the Bitstring Status List spec recommends for herd privacy), how many indexes are assigned and a revision.
- **A revocation is final for that credential.** W3C Bitstring Status List v1.0 §2.1 defines `revocation` as "Used to cancel the validity of a verifiable credential. This status is not reversible." So a bit, once set, is never cleared. `revokeCertificate` sets the bit of the certificate's current credential **in its existing transaction**, conditioned on the list's revision, and in the same transaction moves the certificate's `credential` map into `retiredCredentials` (data-model.md). A certificate with no credential yet has no bit to write.
- **Restoring writes no bit.** `restoreCertificate` is unchanged apart from leaving `retiredCredentials` alone. The restored certificate has no current credential, so its owner's next download binds a new place (R-5) and gets a credential with a new `id` (R-7) that verifies as valid. Copies of the old credential stay revoked, which is what a verifier who already saw the revocation will believe anyway.
- So the rule is simply: a bit is set exactly when its place is retired. An invariant checks it (R-10).
- The page renderer answers `/credentials/status/<n>` with a `BitstringStatusListCredential` built from the record and signed when it is served, with `Cache-Control: public, max-age=60, s-maxage=240`. The renderer's CloudFront behaviour caches at most 300 s, so a revocation is visible to every verifier within 5 minutes (SC-003), with at most one KMS signature per list per 4 minutes per edge.

**Rationale**:

- The specification (§9.1) and certification guide (§4.1) use only `BitstringStatusListEntry`; the implementation guide calls Bitstring Status List "the recommended option". `1EdTechRevocationList` no longer appears in the current spec, and DCC's verifier checks only Bitstring Status List.
- Writing the bit inside the revoke transaction keeps the rule in one core-table helper every writer calls (constitution IV), without a stream feature and its delay or failure queue.
- Keeping `revocation` rather than `suspension`: the OB 3.0 conformance guide (§4.1) defines a credential as revoked when its `BitstringStatusListEntry` has `statusPurpose` `revocation`, and mentions no other purpose. An OB verifier is only required to check that one, so a `suspension` bit would let a revoked Discava certificate pass OB verification.
- Signing on request avoids storing a signed copy that can go stale, and the CDN cache bounds the cost.

**Privacy (FR-012)**: the list shows only bits. Indexes are assigned in order, so someone holding two credentials can guess roughly how many were bound between them; the bits reveal how many credentials in a list are revoked, not which learner. Random assignment would hide the order but needs a claim record per index; it is noted as a limitation, not done.

**Alternatives considered**: clearing the `revocation` bit on restore (the first version of this plan; it breaks §2.1, and verifiers may treat a seen revocation as final, so a restore couldn't be relied on: raised in review); `statusPurpose: "suspension"`, which is reversible (OB 3.0 verifiers aren't required to check it, see above); both a `suspension` entry for revoke-and-restore and a `revocation` entry for nothing (the same gap, and two lists to keep); a stream feature that publishes the list to the media bucket on each change (an extra Lambda, queue and failure mode, and the list could lag the table); `1EdTechRevocationList` (superseded); a per-credential status URL that the renderer answers from the certificate (not a standard status type; verifiers wouldn't check it).

## R-5: When a certificate gets its credential facts: on first download

**Decision**: The first time a certificate's credential is built, `bindCertificateCredential` in core-table fixes, on the certificate, a `credential` map: the status list number and index, the recipient identity (salt and hash, R-6) and when it was bound. It is one transaction: the certificate patch conditioned on no `credential` and no `revokedAt`, and the list's `assignedCount` incremented conditioned on its revision. The loser of a race re-reads and uses the winner's map. Every later download builds the same document from the same facts (spec: "the same content and identifier") until a revocation retires the map (R-4); after a restore the next download binds afresh, with a new place, salt and hash. A revoked certificate is never bound (FR-008).

**Rationale**: It gives every certificate a credential whenever it was issued (FR-009) with one code path, instead of one at issue in the progress recalculation and a backfill for the rest. It keeps `issueCertificate`, a hot and well-tested transaction, unchanged. Indexes are only used by certificates whose owner asked for the credential.

**The race with revoke**: `revokeCertificate` already conditions its patch on `revokedAt` not existing. It also conditions on the `credential` state it read (absent, or present with that index), so a binding that lands between its read and write cancels it and it retries, this time setting the bit and retiring the new map. A binding conditioned on `revokedAt` not existing fails if the revoke landed first. A concurrency test fires both at once.

**Full lists**: when the current list's `assignedCount` reaches 131,072 the binding creates list `n + 1` (create conditioned on not existing) and assigns index 0 there.

## R-6: Identifying the learner

**Decision**: `credentialSubject` has `type: ["AchievementSubject"]`, no `id`, and two `identifier`s (§B.1.12):

1. `{ type: "IdentityObject", identityType: "name", hashed: false, identityHash: "<learnerName>" }`, the name printed on the certificate;
2. when the user record has an email: `{ type: "IdentityObject", identityType: "emailAddress", hashed: true, identityHash: "sha256$<hex>", salt: "<salt>" }`, where `<hex>` is SHA-256 of the trimmed, lower-cased email followed by the salt, and the salt is 16 random bytes as hex, generated at binding.

The plain email, the user's `sub` and any session value never enter the document (FR-004, SC-005). The hash and salt are stored on the certificate's `credential` map, not the email.

**Rationale**: Without a DID the identifier list is how the spec identifies a recipient ("issuance without a wallet"). A salted hash lets a verifier told the email confirm it without the credential exposing it. A wallet-held identifier is out of scope (spec assumptions).

## R-7: The credential document

**Decision**: [contracts/credential-document.md](./contracts/credential-document.md) has the field-by-field shape. Main choices:

- `@context`: `https://www.w3.org/ns/credentials/v2` then `https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json` (§B.1.2; order matters).
- `type`: `["VerifiableCredential", "OpenBadgeCredential"]`.
- `validFrom`: the certificate's `issuedAt`; `awardedDate`: its `completedAt`; no `validUntil` (spec clarification 4).
- `credentialSchema`: the OB 3.0 achievement credential JSON schema with `1EdTechJsonSchemaValidator2019`.
- `id`: `urn:uuid:<UUIDv5 of the issuer id, certificate ID, status list number and index>`. It is stable across downloads and different for the new credential a restored certificate gets, so a revoked credential and its successor never share an identifier. The public page's address is carried as `evidence` (`{ id: <page URL>, type: ["Evidence"], name: "Certificate verification page" }`) instead of as the `id`.
- The achievement: `id` `urn:uuid:<UUIDv5 of the issuer id, course ID and criteria version>`, so two certificates issued under the same criteria share an achievement; `achievementType: "CertificateOfCompletion"` (to be checked against the enum in the schema by the builder's test); `name` the course title as recorded; `description` "Completed the course <title>."; `criteria.narrative` the `assessmentStatement` lines; `image` absent.
- No per-item scores or assessed items (FR-007). No `result`.

**Rationale**: VC 2.0 is the base of OB 3.0 final, so `validFrom` replaces `issuanceDate`. Everything is built from the certificate record and the stage's constants, so a renamed course or a disabled switch doesn't change it (Story 1, scenario 7).

## R-8: Libraries and JSON-LD contexts

**Decision**: Build and sign with Digital Bazaar's libraries: `@digitalbazaar/vc` (issue and, in tests, verify), `@digitalbazaar/data-integrity` and `@digitalbazaar/eddsa-rdfc-2022-cryptosuite`, with a signer object whose `sign({ data })` calls KMS (or the local key, R-11). The JSON-LD document loader serves only bundled contexts: the VC 2.0 context (from `@digitalbazaar/credentials-context` or the W3C file), the OB 3.0.3 context, vendored as a JSON file with a test that pins its SHA-256 to the published file, and nothing from the network. In tests, the loader may also resolve the issuer profile and status list from a fake renderer.

**Rationale**: They are the libraries the DCC and 1EdTech verifiers themselves use, BSD-3-Clause, and their signer interface takes an external signer, so KMS fits without a fork. Bundled contexts keep signing deterministic and offline (a context fetched at sign time is a supply-chain and availability risk).

**Risk**: they are ESM-only and pull in `jsonld` and `rdf-canonize`; the core-api bundle (rolldown) must include them. The first task adds them and checks the bundle size and a cold-start sign on `synth`/`bundle`, before any feature work depends on them. Their licences are checked by the existing `license-check` target.

## R-9: The badge image: SVG with the credential inside

**Decision**: `certificate.badgeImage` returns an SVG built from a fixed template: the brand icon (fetched from the public media bucket and inlined as a `data:` URI, or the default icon), the course title, "Completed <date>" and the platform name, all XML-escaped. As §5.3 says, the root `<svg>` declares `xmlns:openbadges="https://purl.imsglobal.org/ob/v3p0"` and its first child is one `<openbadges:credential>` element holding the signed credential JSON in a CDATA section. Any `]]>` in the JSON is written as `]]\u003e` (valid JSON, so the parsed credential is unchanged).

**Rationale**: The spec's Story 4 needs the course title on the image in any script. A PNG would need a server-side rasteriser with fonts for every script (a native dependency in the Lambda bundle, and the PDF's Latin-1 limit shows what happens without one). An SVG is text, drawn by the viewer's fonts, and baking it is string assembly. §5.3 defines SVG baking alongside PNG, and certification tests only displaying baked images (both formats). The spec is amended from PNG to SVG in this pull request.

**Alternatives considered**: baking into the brand's PNG icon (no course title on it); rasterising the SVG to PNG with `@resvg/resvg-js` (native binary, bundle size and fonts); offering both (doubles the tests for little gain). PNG can follow if a target site refuses SVG.

## R-10: Rules that span records (invariants)

New checks in `core-table/src/helpers/invariants/credentials.ts`:

- `credential-status-matches-certificate`: a bit is set exactly when its place is a retired credential of some certificate. So every current `credential` has its bit clear, every `retiredCredentials` entry has its bit set, and no set bit is unaccounted for. A certificate with `revokedAt` has no current `credential`.
- `credential-status-index-unique`: no two places (current or retired, across all certificates) share a list and index, and every index is below the list's `assignedCount`.
- `credential-status-list-shape`: list numbers run from 1 with no gaps, the bits are 16,384 bytes, `assignedCount` is between 0 and 131,072, and only the last list may be not full.
- `certificate-credential-shape` (extends the existing `certificate-shape`): a `credential` map, when present, has a list number and index, a bound time not before `issuedAt`, and either both salt and hash (a `sha256$` hash of 64 hex characters) or neither.

Not violations: a certificate with no `credential` (never downloaded, or restored and not downloaded since), and a valid certificate with retired credentials (revoked and restored).

## R-11: Local development

**Decision**: `LOCAL_DEV=true` swaps the KMS signer for a local Ed25519 key in `tmp/local-dev/secrets/credential-signing-key.json` (PKCS#8 and the public key, made with `node:crypto` on first use and written with an exclusive create, so the API and the renderer, separate processes, end up with the same key). `reset-local-data` already deletes `tmp/local-dev/`, together with the table the bindings live in. The local `/credentials/settings` equivalent is a constant in `common-server-utils/local-dev` (`issuerOrigin` the local renderer, one key `local-1`). No deployed stage trusts the local key (spec edge case).

**Rationale**: Constitution III. The same signer interface is used, so local signatures go through the same cryptosuite code as deployed ones.

## R-12: What the e2e can and can't check

The e2e scenario verifies a downloaded credential inside the test with `@digitalbazaar/vc`'s `verifyCredential`, using a document loader that fetches the issuer profile and status list over HTTP from the local renderer. That proves the published profile, keys and status agree with the file. Conformance to a third-party verifier (SC-001) needs a public address, so it is a `(human)` task on `discava-development` with the 1EdTech validator and DCC's verifier.
