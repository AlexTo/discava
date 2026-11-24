# Implementation Plan: Certificates as Open Badges 3.0 Verifiable Credentials

**Branch**: `20261124-192104-open-badges-credentials` | **Date**: 2026-11-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261124-192104-open-badges-credentials/spec.md`

## Summary

A certificate's owner can download it as an Open Badges 3.0 `OpenBadgeCredential`: a VC 2.0 JSON document with an embedded `eddsa-rdfc-2022` Data Integrity proof, signed with a per-stage Ed25519 key held in AWS KMS. Two new core-api queries, `certificate.credential` and `certificate.badgeImage`, run on a new dedicated `Credentials` function, the only core-api function allowed to sign. They build the document on request from the certificate record. The first request fixes the credential's facts on the certificate: a place in a Bitstring Status List and a salted hash of the learner's email. The page renderer, which already answers `/certificates/*` through the student portal's CloudFront distribution, also answers `/credentials/issuer` (the issuer profile and its public keys) and `/credentials/status/<n>` (the signed status list), signed out and CDN-cached. Revoking sets the certificate's status bit, and retires its credential, in the transaction that already changes the certificate, so a verifier sees a revocation within 5 minutes and the bit can never disagree with the certificate. A revocation is final, as the standard defines it: restoring the certificate writes no bit, and the owner's next download is a new credential with a new identifier and a new place in the list. The badge image is an SVG with the signed credential baked in.

What the existing code and the standard showed that the spec could not:

1. **OB 3.0 has moved on.** The final spec is VC 2.0 (`validFrom`, not `issuanceDate`), revocation is Bitstring Status List (`1EdTechRevocationList` is gone), and the certification guide lists only Data Integrity suites. VC-JWT also can't express a subject with no `id`, which ours is (R-1, R-4, R-6).
2. **AWS KMS signs Ed25519 now** (`ECC_NIST_EDWARDS25519`, raw messages), and the repo's `aws-cdk-lib` has the key spec, so the key can stay in KMS (R-2).
3. **The page renderer is the public, cached, host-checked endpoint already in place.** It answers `/certificates/*` through CloudFront with a 300 s cache cap. Adding `/credentials/*` to its paths gives the issuer profile and status lists a public address on the platform's own domain with no new API (R-3).
4. **`revokeCertificate` and `restoreCertificate` are already the only writers of revocation**, each one transaction. Adding the bit write to the revoke puts the status list rule where constitution IV wants it (R-4, R-5). Discava's revocation can be undone, but the standard's can't (W3C Bitstring Status List §2.1), so a restore issues a new credential instead of clearing the bit (R-4, raised in review).
5. **The PDF's Latin-1 limit** is why the badge image is SVG, not PNG: no server-side font rendering (R-9). The spec is amended in this pull request.
6. **The `Data` stack already writes the page renderer's SSM parameter** and imports its role. The key and the new `/<stage>/credentials` parameter go there too, with no new stack dependency (R-3).

## Technical Context

**Language/Version**: TypeScript (Node 22 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC + zod, ElectroDB (`@discava/core-table`), AWS SDK v3 (`@aws-sdk/client-kms`, new in core-api), `@digitalbazaar/vc`, `@digitalbazaar/data-integrity`, `@digitalbazaar/eddsa-rdfc-2022-cryptosuite` (new in core-api; R-8), `ajv` (tests only, already in the lockfile), TanStack Router/Query, shadcn

**Storage**: the core table: new entity `credentialStatusList`, new `credential` map on `certificate`, no new index. One KMS key per stage. One SSM parameter per stage

**Testing**: vitest per project; core-table `helpers/invariants/` with breaking tests; student portal component tests; Playwright e2e in `packages/e2e` including `src/concurrency/`; construct and stack tests with `synth`/checkov

**Target Platform**: AWS Lambda + API Gateway + CloudFront + KMS; `pnpm dev` locally with a local Ed25519 key (R-11)

**Project Type**: web application: serverless backend + React portals

**Performance Goals**: download in under 3 s (SC-004): one table read, one bind at most, one KMS `Sign`, JSON-LD canonicalisation with bundled contexts; status visible within 5 min (SC-003) through `max-age=60, s-maxage=240` under the renderer's 300 s cap

**Constraints**: the private key never leaves KMS (FR-014); no network fetch at sign time (bundled contexts); no scan in a request; no learner data in public documents (FR-012); `pnpm dev` without AWS (FR-020)

**Scale/Scope**: one key per stage (more after a rotation); 131,072 credentials per status list, more lists as needed; two public addresses (`/credentials/issuer`, `/credentials/status/<n>`) and two procedures

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | KMS asymmetric key, Lambda, CloudFront, DynamoDB, SSM. No non-AWS service at run time; verifiers are the outside world's |
| II. Generators first | Pass | No new project. The `Credentials` dedicated function uses the existing `CORE_API_DEDICATED_FUNCTIONS` mechanism, and the key construct is hand-written in `common-constructs` like `StripeSecrets`, as no `@aws/nx-plugin` generator makes KMS keys. T001 confirms that with the MCP server |
| III. Everything runs locally | Pass | Local Ed25519 key in `tmp/local-dev/secrets/`, same signer interface; the local renderer serves `/credentials/*`; the e2e verifies against it (R-11, R-12) |
| IV. Layered tests | Pass, planned | Unit tests for the builder, signer, status list encoding, SVG, procedures and renderer routes; three new invariants and extended `certificate-shape` with breaking tests; an e2e scenario and a concurrency test. Impact check below |
| V. Single-table via ElectroDB | Pass | One new entity in the core table; access patterns A1 to A5 in [data-model.md](./data-model.md), all keys, no index, no scan. The stream router's features are checked against the new attribute and entity |
| VI. Secure by default | Pass | Key is non-exportable, `RETAIN`, with a key policy granting `kms:Sign`/`GetPublicKey` to two roles only; core-api's grant is on a dedicated function, not the shared handler. Public documents carry no learner data; CORS `*` only on the two public JSON documents, which hold nothing private |
| VII. Change freely before launch | Pass | No compatibility code. The issuer address follows the stage's domain; if a stage changes domain before launch, old dev credentials stop resolving, which is accepted |
| VIII. Repo conventions | Pass | `core-table/src/helpers/certificate-credential.ts`, `invariants/credentials.ts`; core-api `helpers/credentials/`; local constants in `common-server-utils/local-dev`; text-only buttons; e2e `screenshot()`s; docs in English with translations noted as pending |

No violations, so Complexity Tracking is empty.

**Impact check (constitution IV).** Shared records the feature writes or reads in a new way:

| Record | Use | Existing invariants and tests that already cover it | What changes |
|--------|-----|------------------------------------------------------|--------------|
| `certificate` | Gains `credential` (set by `bindCertificateCredential`, retired by `revokeCertificate`) and `retiredCredentials` (appended by `revokeCertificate`); revoke now also conditions on `credential` | `certificate-shape`, `certificate-status-matches-history`, `certificate-met-criteria`, `certificate-has-completed-enrolment`; `certificate.test.ts`; `concurrency/certificate-revoke.e2e.ts` | `certificate-shape` extended with the `credential` and `retiredCredentials` rules (breaking tests); `certificate.test.ts` gains bind, revoke-retires and restore-then-rebind cases; new concurrency test bind vs revoke |
| `credentialStatusList` (new) | Written by bind and revoke (never by restore; bits are never cleared); read by the renderer | none yet | New `credential-status-matches-certificate`, `credential-status-index-unique`, `credential-status-list-shape` with breaking tests; `snapshot.ts`; `entity-writers.json` regenerated |
| `certificateEvent` | Written by revoke and restore as today | `certificate-status-matches-history` | None: the event and the bit are in the same transaction, so the existing rule still holds |
| `user` | Read for the email at bind | unchanged | None |
| Stream features (`STREAM_FEATURES`) | `certificate` modify with only `credential` changed; `credentialStatusList` records | `stream-features.test.ts`, `progress-stream`, `notification-stream`, `analytics-stream` tests | `stream-features.test.ts` asserts neither reaches any feature |

The feature writes no counter, enrolment, completion or content record.

## Design Decisions (detail in [research.md](./research.md))

1. **Data Integrity `eddsa-rdfc-2022`, JSON delivery** (R-1). Matches the certification guide and the free verifiers; avoids VC-JWT's subject-id rule.
2. **Ed25519 key in KMS, one per stage, rotation by adding keys** (R-2). Only the `Credentials` function and the page renderer may sign.
3. **HTTPS issuer on the student portal's origin, served by the page renderer** (R-3). `/credentials/issuer` is both the issuer profile and the controller document for the keys.
4. **Bitstring Status List, bits written with the revoke and never cleared** (R-4). `revocation` is not reversible, so a restored certificate gets a new credential on its next download. Signed when served, CDN-cached within the 5-minute budget.
5. **Facts fixed on first download** (R-5). One path for every certificate; the progress recalculation is unchanged.
6. **Learner identified by name and a salted email hash** (R-6). No wallet identifier.
7. **SVG badge image** (R-9). Text in any script, no native renderer.
8. **Bundled JSON-LD contexts, pinned by hash** (R-8). Signing never fetches from the network.

## Project Structure

### Documentation (this feature)

```text
specs/20261124-192104-open-badges-credentials/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── credential-document.md
│   ├── core-api-credential.md
│   └── student-portal-ui.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/
├── databases/core-table/src/
│   ├── entities/credential-status-list.ts         # new (+ index.ts, service.ts)
│   ├── entities/certificate.ts                    # + credential map
│   └── helpers/
│       ├── certificate-credential.ts              # bindCertificateCredential, statusBitWrites, bit helpers (+ test)
│       ├── certificate.ts                         # revoke sets the bit and retires the credential; restore unchanged (+ tests)
│       ├── stream-features.test.ts                # credential-only modify and status lists reach no feature
│       └── invariants/credentials.ts              # three checks (+ breaking tests); certificates.ts, snapshot.ts, index.ts
├── databases/core-table/entity-writers.json       # regenerated
├── apis/core-api/src/
│   ├── helpers/credentials/
│   │   ├── contexts/                              # vendored VC 2.0 and OB 3.0.3 contexts, OB schema (+ hash test)
│   │   ├── document-loader.ts                     # bundled contexts only (+ test)
│   │   ├── credential-settings.ts                 # reads /<stage>/credentials once; local constant (+ test)
│   │   ├── signer.ts                              # KMS Ed25519 signer; local key (+ test)
│   │   ├── open-badge.ts                          # build the unsigned credential and issuer profile (+ test)
│   │   ├── status-list.ts                         # encode the bitstring, build the list credential (+ test)
│   │   └── badge-svg.ts                           # the SVG template and baking (+ test)
│   ├── procedures/certificate.ts                  # credential, badgeImage (+ tests); router.ts; schema/certificate.ts
│   └── page-renderer/
│       ├── render-credentials.ts                  # /credentials/issuer, /credentials/status/<n> (+ test)
│       └── handler.ts                             # route /credentials/*
├── common/server-utils/src/local-dev.ts           # LOCAL_CREDENTIALS settings and key path
├── common/constructs/src/
│   ├── core/credential-signing-keys.ts            # KMS keys, alias, grantSign (+ test)
│   ├── app/apis/core-api.ts                       # Credentials in CORE_API_DEDICATED_FUNCTIONS (+ test)
│   └── app/static-websites/student-portal.ts      # /credentials/* in PAGE_RENDERER_PATHS (+ test)
├── infra/src/stacks/data-stack.ts                 # keys, /<stage>/credentials parameter, grants to the renderer role (+ test)
├── infra/src/stacks/core-api-stack.ts             # Credentials function: kms grants, parameter read (+ test)
├── common/infra-config/src/stages.types.ts        # credentialKeys?: string[] (default ['key-1']) (+ config tests)
├── websites/student-portal/src/
│   ├── components/certificate-actions.tsx         # two download buttons (+ test)
│   └── routes/certificates/$certificateId/        # owner-share.tsx buttons, the credential line (+ tests)
├── e2e/src/
│   ├── helpers/verify-credential.ts               # verify a file against the local renderer
│   ├── scenarios/credential.e2e.ts                # Stories 1 to 4
│   └── concurrency/credential-bind-revoke.e2e.ts
docs/src/content/docs/en/
├── design/certificates.mdx                        # "Verifiable credentials" section; spec link
└── deploy/configuration.mdx                       # credentialKeys and rotation
```

**Structure Decision**: extend existing packages; no new project. Credential code lives in core-api's `helpers/credentials/` because its two users, the `Credentials` function and the page renderer, are both core-api handlers. Core-table holds the binding and the bit, because revoke, which instructor-api and admin-api call, must write the bit too.

## Risks

- **R1: Bundling the JSON-LD stack.** `jsonld`/`rdf-canonize` are ESM and sizeable. Phase 1 adds them and proves a sign under the core-api bundle before anything depends on them. Fallback: move credential code into its own Lambda bundle entry so the main handler doesn't grow.
- **R2: Verifier acceptance.** The 1EdTech validator and VerifierPlus are run by hand on `discava-development` (quickstart). VerifierPlus may say the issuer isn't in a registry; joining one (and possibly a `did:web` issuer) is a follow-up, not this feature.
- **R3: KMS Ed25519 signature encoding.** Not stated in AWS docs; a recorded response in a unit test and the `(human)` deploy check confirm 64 raw bytes before the MVP merges.
- **R4: Status list contention.** Every bind and revoke in a list writes one record with a revision check. At Discava's scale retries are rare; the bind retries a bounded number of times and the concurrency test exercises it.
- **R5: The issuer address is the stage's domain.** Adding a custom domain to a stage later changes the issuer for new credentials and leaves old ones pointing at the CloudFront domain, which keeps working while the distribution exists. The deploy docs say to set the domain before issuing credentials.
- **R6: The renderer signs on request.** A flood of distinct `/credentials/status/<n>` paths for lists that exist is bounded by the number of lists; unknown numbers are a `404` without signing. Reserved concurrency already caps the renderer.
- **R7: Old credentials stay revoked after a restore.** A learner who shared a credential before a mistaken revocation has to share the new one; the old one never verifies again. This follows the standard and is the cost of the restore feature; the design page says so (T022).

## Complexity Tracking

*No constitution violations.*
