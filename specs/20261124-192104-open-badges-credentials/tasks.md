---

description: "Task list for certificates as Open Badges 3.0 verifiable credentials"
---

# Tasks: Certificates as Open Badges 3.0 Verifiable Credentials

**Input**: Design documents from `/specs/20261124-192104-open-badges-credentials/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires them, so they are included: unit tests for the credential builder, signer, status list, SVG, the core-table helpers, both procedures and the renderer routes; three new invariants and an extended `certificate-shape`, each with breaking tests; component tests for the student portal; one `packages/e2e` scenario and one concurrency test. Write each task's tests first and see them fail. Never weaken an existing test to make it pass; where a task changes behaviour an existing test pins (the revoke transaction's items), the task names the change.

**Who runs what**: an automated agent implements these tasks without `pnpm dev` or Docker. It runs unit and component tests, lint, typecheck, `build` and `synth` locally. Whenever a task changes which code writes the core table, it also runs `pnpm nx run @discava/tooling-agent:entity-writers` and commits the regenerated `packages/databases/core-table/entity-writers.json`, or the `Invariant coverage` PR check fails. The e2e scenario and concurrency test are written by the agent but run on PR CI (`pr-checks.yml`'s `E2E tests` job). Tasks marked **(human)** need a running local stack, a deployed stage or people; a reviewer does them before merge.

**Organization**: Seven phases, each one agent PR merged in order; each leaves `main` green and working. Story labels: US1 download a credential (P1), US2 verify without trusting the file (P1), US3 revocation follows the credential (P2), US4 badge image (P3). Paths are relative to the repository root. There is no tracking issue yet; open one before Phase 1 and reference it as "Part of #<n>" in every PR, with only the last PR closing it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: which user story the task serves (US1 to US4)
- **(human)**: needs a running local stack, a deployed stage or people; not done by the agent

---

## Phase 1: Setup: libraries, contexts and the signer (PR 1)

**PR title**: `feat(credentials): signing libraries, bundled contexts and the credential signer`

**Goal**: core-api can sign a Data Integrity proof with a local key and with a (faked) KMS key, offline, inside its bundle. No user-visible change.

- [ ] T001 Confirm with the `nx-plugin-for-aws` MCP server (`list-generators`, `generator-guide`) that no generator creates a KMS key construct or a dedicated core-api function (constitution II), and record the answer in the PR description. If one applies, use it in T012 and T014 instead of hand-writing.
- [ ] T002 Add `@digitalbazaar/vc`, `@digitalbazaar/data-integrity`, `@digitalbazaar/eddsa-rdfc-2022-cryptosuite` and `@aws-sdk/client-kms` to `packages/apis/core-api/package.json` (pinned, each release at least two weeks old) and `@digitalbazaar/vc` to `packages/e2e` devDependencies. Run `pnpm nx run @discava/core-api:bundle` and record the bundle size before and after in the PR description (plan risk R1). Confirm `license-check` passes.
- [ ] T003 Test first, then vendor the contexts and schema under `packages/apis/core-api/src/helpers/credentials/contexts/`: the VC 2.0 context (`https://www.w3.org/ns/credentials/v2`), the OB 3.0.3 context (`https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json`) and the OB 3.0 achievement credential JSON schema, each as fetched on the day with its URL and SHA-256 in a comment-free `contexts/manifest.json`. Add `document-loader.ts`: resolves exactly those URLs from the files and throws for any other URL, never fetching (research R-8). Tests: each URL resolves to its file; the file's SHA-256 equals the manifest's; an unknown URL throws.
- [ ] T004 Test first, then add the local settings to `packages/common/server-utils/src/local-dev.ts`: `LOCAL_CREDENTIALS = { issuerOrigin: LOCAL_PAGE_RENDERER_URL, keys: [{ name: 'local-1' }], currentKey: 'local-1' }` and the key file path `tmp/local-dev/secrets/credential-signing-key.json` (research R-11). Add `packages/apis/core-api/src/helpers/credentials/credential-settings.ts`: `resolveCredentialSettings()` reads the SSM parameter named by `CREDENTIALS_PARAMETER` (JSON `{ issuerOrigin, currentKey, keys: [{ name, keyArn }] }`) once per container, forgetting a failed read, like `resolvePageRendererSettings`; with `LOCAL_DEV=true` returns `LOCAL_CREDENTIALS`. Tests: a valid parameter; missing env var; invalid JSON; a missing field; the current key not in `keys`; local dev.
- [ ] T005 Test first, then add `packages/apis/core-api/src/helpers/credentials/signer.ts`: `credentialSigner(settings)` returns, per key, `{ id: '<issuerOrigin>/credentials/issuer#<name>', algorithm: 'Ed25519', sign({ data }) }` and `publicKeyMultibase(name)`. Deployed: `sign` calls KMS `Sign` (`ED25519_SHA_512`, `MessageType: RAW`) on the key's ARN and returns the signature bytes; the public key comes from `GetPublicKey` (SPKI DER → 32-byte key → multibase `z` + base58btc of `0xed01` + key), cached per container. Local: an Ed25519 key from `node:crypto`, created on first use with an exclusive create (`wx`) of the key file and read back on `EEXIST`, so the API and renderer processes share one key. Tests: with a fake KMS client recording the request, the signature is accepted by `node:crypto`'s Ed25519 verify on a key built from the multibase; a recorded `Sign` response of 64 bytes is returned unchanged and any other length throws (plan risk R3); two concurrent local first-uses end with one key; the multibase of a known key matches a fixture.
- [ ] T006 Test first, then add a smoke helper `signDataIntegrity(document, signer)` in `packages/apis/core-api/src/helpers/credentials/open-badge.ts` that signs with `eddsa-rdfc-2022` through `@digitalbazaar/vc` and the T003 loader. Test: a minimal VC 2.0 credential signed with the local signer verifies with `@digitalbazaar/vc`'s `verifyCredential` given a loader that also returns a controller document for the key; a one-character change fails. Confirm the test also passes on the built bundle (`bundle` target), not only under vitest.

---

## Phase 2: Foundational: status lists and binding in core-table (PR 2)

**PR title**: `feat(credentials): status lists and credential binding in core-table`

**Goal**: a certificate can be bound to a status list place and a recipient hash, and a revoke sets its bit for good and retires the place, with the invariants that hold it. Nothing calls the binding yet.

- [ ] T007 Test first, then add the `credentialStatusList` entity in `packages/databases/core-table/src/entities/credential-status-list.ts` per data-model.md (`listNumber`, `bits` binary of 16,384 bytes, `assignedCount`, `revision`, timestamps; `pk` constant, `sk` zero-padded list number), export it from `entities/index.ts` and add it to `service.ts`. Add the `credential` map (`statusListNumber`, `statusListIndex`, `recipientSalt`, `recipientHash`, `boundAt`) and the `retiredCredentials` list of `{ statusListNumber, statusListIndex }` to `entities/certificate.ts`. Tests: the keys, and that a query on the constant partition descending returns the highest list first.
- [ ] T008 Test first, then add `packages/databases/core-table/src/helpers/certificate-credential.ts`: `STATUS_LIST_SIZE = 131072`; `getBit`, `setBit` (most significant bit first, data-model.md); `recipientHash(email, salt)` (`sha256$` + hex of SHA-256 over trimmed lower-cased email + salt); and `bindCertificateCredential({ coreTable, certificate, user, now })` with the transaction, conditions and retries in data-model.md, throwing `CertificateRevokedError` (new, in `helpers/errors.ts`) for a revoked certificate. Tests: first bind assigns index 0 in list 1 and increments `assignedCount`; a second bind returns the stored map unchanged; a user without email gets no salt or hash; a full list makes list 2 with index 0; two binds of different certificates at once get different indexes (one retries on the revision); two binds of the same certificate return the same map; a revoked certificate throws; a restored certificate (no `credential`, one retired place) binds a new index with a new salt; the email never appears in any written item.
- [ ] T009 Test first, then extend `revokeCertificate` in `packages/databases/core-table/src/helpers/certificate.ts`: when the stored certificate has `credential`, read its list and add a `credentialStatusList` patch setting its bit with a `revision` condition, extend the certificate patch to remove `credential` and append its place to `retiredCredentials`, and condition the patch on the `credential` state read (data-model.md, research R-4, R-5); on a cancel from either new condition, re-read and retry (bounded). Leave `restoreCertificate`'s writes unchanged: it never clears a bit (`revocation` is not reversible). The existing tests that assert the revoke transaction has exactly two items change to expect a third item only when the certificate is bound; name this in the PR description. Tests: revoking a bound certificate sets its bit and nothing else in the list, and moves the place to `retiredCredentials`; restoring it writes no list item, keeps the bit set and the retired place; revoking again after a re-bind retires the second place too; an unbound certificate's revoke writes no list item; a bind landing between the revoke's read and write makes the revoke retry, set the bit and retire it; the event and notification behaviour is unchanged.
- [ ] T010 Test first, then add the invariants in `packages/databases/core-table/src/helpers/invariants/credentials.ts` (`credential-status-matches-certificate`, `credential-status-index-unique`, `credential-status-list-shape`) and the `credential` rules in `certificate-shape` (`invariants/certificates.ts`), per research R-10; add `credentialStatusList` to `TableSnapshot` and `SNAPSHOT_ENTITIES` in `snapshot.ts` and the new list to `CHECKS` in `index.ts`. Breaking tests in `credentials.test.ts` and `certificates.test.ts`, from `consistentTable()`: a retired place with its bit clear; a current `credential` with its bit set; a set bit belonging to no retired place; a revoked certificate that still has a current `credential`; two places (current or retired) on one index; an index at or above `assignedCount`; a gap in list numbers; a non-last list not full; bits of the wrong length; a hash without a salt; a hash not matching `sha256$` + 64 hex; `boundAt` before `issuedAt`. Also show a certificate without `credential`, a restored certificate with retired places and no current one, and an empty table pass. Then run `entity-writers` and commit the regenerated `entity-writers.json`.
- [ ] T011 Test first, then in `packages/databases/core-table/src/helpers/stream-features.test.ts` assert that a `certificate` modify changing only `credential` reaches no stream feature, and that `credentialStatusList` inserts and modifies reach none (data-model.md "Stream router"). If a feature's filter does match, narrow that filter in its `*-stream.ts` and say why in the PR description.

---

## Phase 3: Foundational: key, settings and routes in infrastructure (PR 3)

**PR title**: `feat(credentials): signing key, credentials parameter and public credential paths`

**Goal**: each stage has its Ed25519 key, the `/<stage>/credentials` parameter, a `Credentials` core-api function allowed to sign, and `/credentials/*` reaching the page renderer. The renderer answers it with `404` until Phase 4.

- [ ] T012 Test first, then add `packages/common/constructs/src/core/credential-signing-keys.ts`: one KMS `Key` per name in `keyNames` (`KeySpec.ECC_NIST_EDWARDS25519`, `KeyUsage.SIGN_VERIFY`, `RemovalPolicy.RETAIN`, alias `alias/<stage>/credential-signing/<name>`), `currentKey` the last name, and `grantSign(grantee)` (`kms:Sign` and `kms:GetPublicKey` on every key) (research R-2). Suppress checkov's key-rotation rule with the reason (KMS can't rotate asymmetric keys; rotation is adding a key) through `suppressRules`. Tests: key spec, usage, retention, alias, a second name makes a second key and makes it current, the grant's actions and resources.
- [ ] T013 Test first, then add `credentialKeys?: string[]` (default `['key-1']`, at least one, unique, `[a-z0-9-]{1,32}`) to the stage config in `packages/common/infra-config/src/stages.types.ts` and its validation; and in `packages/infra/src/stacks/data-stack.ts` create `CredentialSigningKeys`, write the `/<stage>/credentials` parameter (`{ issuerOrigin, currentKey, keys: [{ name, keyArn }] }`, where `issuerOrigin` is `https://` + the first `studentPortal.domainNames` entry or the distribution's domain; research R-3), and grant sign and parameter read to the imported page-renderer role. Pass the parameter's name to the renderer as `CREDENTIALS_PARAMETER`. Tests in `data-stack.test.ts`: the parameter value with and without a custom domain; the renderer role's KMS and SSM grants; the keys are retained.
- [ ] T014 Test first, then add `Credentials: ['certificate.credential', 'certificate.badgeImage']` to `CORE_API_DEDICATED_FUNCTIONS` in `packages/common/constructs/src/app/apis/core-api.ts` (comment: the only core-api function that may sign credentials), and in `packages/infra/src/stacks/core-api-stack.ts` grant it `grantSign`, read of `/<stage>/credentials` (`CREDENTIALS_PARAMETER`), and `s3:GetObject` on the public media bucket's `brand/*` (for the badge icon). Register the two procedure names as stubs that throw `NOT_IMPLEMENTED` so the mapping test passes. Tests: the shared handler has no KMS grant; the `Credentials` function has exactly these.
- [ ] T015 Test first, then add `'/credentials/*'` to `PAGE_RENDERER_PATHS` in `packages/common/constructs/src/app/static-websites/student-portal.ts`, and route `/credentials/*` in `packages/apis/core-api/src/page-renderer/handler.ts` to a `renderCredentials` stub answering `404` JSON (contracts/credential-document.md "HTTP"). Tests: the behaviour exists with the same cache and origin-request policies; the stub's status, headers and body.

---

## Phase 4: User Stories 1 and 2 - Download and verify a credential (Priority: P1) 🎯 MVP (PR 4)

**PR title**: `feat(credentials): download a certificate as a verifiable Open Badges 3.0 credential`

**Goal**: the owner downloads a signed credential from My Learning and the public page; anyone verifies it against the published issuer profile and status list.

**Independent test**: download a credential as the owner, verify it with `@digitalbazaar/vc` fetching the issuer profile and status list from the renderer: valid, not revoked. Change one character: invalid. Another user and a signed-out visitor get no download (spec US1, US2).

- [ ] T016 [US1] Test first, then build the unsigned credential in `packages/apis/core-api/src/helpers/credentials/open-badge.ts`: `buildOpenBadgeCredential({ certificate, settings, brand, mediaBaseUrl })` and `buildIssuerProfile({ settings, brand, mediaBaseUrl, publicKeys })` per contracts/credential-document.md (achievement `urn:uuid` as UUIDv5 from `node:crypto` hashing, `criteria.narrative` from `assessmentStatement`). Tests: a golden document from a fixture certificate (`id` a `urn:uuid` from the place, the public page as `evidence`); two places give two different `id`s; the document validates against the vendored OB schema with `ajv` (and `achievementType` is in its enum, research R-7); building twice is identical; the walk for `sub`, email, `assessedItems`, scores and revocation fields finds nothing (SC-005); no `emailAddress` identifier without a hash.
- [ ] T017 [US2] Test first, then add `packages/apis/core-api/src/helpers/credentials/status-list.ts`: `encodeStatusList(bits)` (gzip, base64url, `u` prefix) and `buildStatusListCredential({ listNumber, bits, settings, now })` per the contract. Tests: an all-clear list and one with bits 0 and 131071 set decode back to the same bits; the document's ids and `statusPurpose`.
- [ ] T018 [US1] Test first, then implement `certificate.credential` in `packages/apis/core-api/src/procedures/certificate.ts` with its schema in `schema/certificate.ts`, per contracts/core-api-credential.md: read, refuse revoked, `bindCertificateCredential` (map `CertificateRevokedError` to the revoked message), build, sign with the current key, return `{ fileName, credential }`. Tests: every case in the contract's "Tests" list for `certificate.credential`, including the one-character change over every leaf field (SC-002) and a KMS failure leaving the binding in place.
- [ ] T019 [US2] Test first, then implement `renderCredentials` in `packages/apis/core-api/src/page-renderer/render-credentials.ts`: `/credentials/issuer` (profile with one `Multikey` per configured key and `assertionMethod`), `/credentials/status/<n>` (read the list, build, sign, serve), anything else and unknown lists `404`, with the headers in the contract. Tests: both documents and headers; an unknown list doesn't sign; the request's host never appears in a document; with a fake document loader serving these responses, a credential from T018 verifies and reports not revoked.
- [ ] T020 [US1] Test first, then add "Download credential" to `packages/websites/student-portal/src/components/certificate-actions.tsx` and to the owner section `src/routes/certificates/$certificateId/-components/owner-share.tsx`, and the verifiable-credential line on the public page for a valid certificate, per contracts/student-portal-ui.md. Tests (`renderWithCoreApi`): the button calls `certificate.credential` with the course and saves the file name; "Preparing…" while pending; the error alert with retry; hidden for a revoked certificate; the line shows for any viewer of a valid certificate; the button only for the owner.
- [ ] T021 [US1] [US2] Add `packages/e2e/src/helpers/verify-credential.ts` (verify a credential file or SVG with `@digitalbazaar/vc` and a loader that serves the bundled contexts and fetches `/credentials/*` from the local renderer; also runnable as a script for quickstart.md) and `packages/e2e/src/scenarios/credential.e2e.ts` (read `packages/e2e/README.md` first): a new instructor and student, a course with certificates on, completion; the student downloads from My Learning (`screenshot()` of the actions at desktop and phone width) and from the public page; the file verifies as valid and not revoked; a copy with the course title changed fails; another student and a signed-out visitor see the line but no button (`screenshot()`).
- [ ] T022 [US1] [US2] Docs, English only: add a "Verifiable credentials" section to `docs/src/content/docs/en/design/certificates.mdx` (what is signed and how, the issuer profile and keys, binding on first download, the status list and its 5-minute budget, why a revocation is final and a restore means downloading the credential again, privacy, local signing, limitations: sequential indexes, no wallet identifier, issuer tied to the stage's domain) with this spec in its "Spec" lines, and the `credentialKeys` setting and how to add a key without removing the old one to `docs/src/content/docs/en/deploy/configuration.mdx`. Note in the PR that translations are pending.

---

## Phase 5: User Story 3 - Revocation follows the credential (Priority: P2) (PR 5)

**PR title**: `test(credentials): revoked certificates' credentials stop verifying`

**Goal**: show end to end that a revocation reaches verifiers and is final, that a restored certificate gets a new credential, and that the race between binding and revoking is safe.

**Independent test**: download, revoke, verify: revoked; restore: the old file is still revoked, a new download is valid (spec US3).

- [ ] T023 [US3] Test first, then pin the status list's cache headers to the 5-minute budget in `render-credentials.test.ts` (`max-age` + `s-maxage` ≤ 300, under the behaviour's 300 s cap, plan Design Decision 4) and add a construct test that fails if the page-renderer cache policy's `maxTtl` rises above 300 s.
- [ ] T024 [US3] Extend `packages/e2e/src/scenarios/credential.e2e.ts`: the instructor revokes the certificate; the downloaded file now verifies as revoked, and My Learning and the owner's page hide both downloads (`screenshot()`); an administrator restores it; the old file still verifies as revoked; the student downloads again and the new file has a different `id` and verifies as valid. A second student's credential in the same list stays valid throughout.
- [ ] T025 [US3] Add `packages/e2e/src/concurrency/credential-bind-revoke.e2e.ts` (follow the existing files in `src/concurrency/`): for several fresh certificates, fire `certificate.credential` (student) and the instructor's revoke at the same moment; assert each outcome is either "revoked, never bound" or "bound and bit set", the download answers either a credential or the revoked message, and the invariant check passes.

---

## Phase 6: User Story 4 - A badge image that carries the credential (Priority: P3) (PR 6)

**PR title**: `feat(credentials): download a badge image with the credential baked in`

**Goal**: the owner downloads an SVG badge that shows the course and embeds the signed credential.

**Independent test**: download the badge image, view it, and verify the credential extracted from it (spec US4).

- [ ] T026 [US4] Test first, then add `packages/apis/core-api/src/helpers/credentials/badge-svg.ts`: `bakeBadgeSvg({ credential, courseTitle, completedOn, platformName, iconDataUri })` per research R-9 (namespace on the root, `openbadges:credential` as first child, CDATA with `]]>` escaped as `]]\u003e`, every text XML-escaped). Tests: the SVG parses; the first child is the credential element; the extracted JSON equals the input after `JSON.parse`; a title with `<`, `&`, `]]>` and Chinese characters round-trips; no `<script>` or external reference appears.
- [ ] T027 [US4] Test first, then implement `certificate.badgeImage` in `packages/apis/core-api/src/procedures/certificate.ts` per contracts/core-api-credential.md (the icon from the public media bucket as a data URI, default icon on failure). Tests: the contract's `badgeImage` cases; a missing icon falls back and logs.
- [ ] T028 [US4] Test first, then add "Download badge image" beside "Download credential" in `certificate-actions.tsx` and `owner-share.tsx`. Tests as T020 for the second button.
- [ ] T029 [US4] Extend `packages/e2e/src/scenarios/credential.e2e.ts`: the student downloads the badge image; `verify-credential.ts` extracts and verifies it; the image opened in the browser shows the course title (`screenshot()`).

---

## Phase 7: Polish: final sweep and manual checks (PR 7)

**PR title**: `docs(credentials): final sweep and verifier checks`

**Goal**: everything consistent, and the checks only a person on a deployed stage can make.

- [ ] T030 Final sweep: run `pnpm nx run-many --target test`, `pnpm lint` and `pnpm build` (including `synth` and `checkov`); confirm `entity-writers.json` is current; no TODO or skipped test was added; `grep -rn "NOT_IMPLEMENTED" packages/apis/core-api/src` finds nothing from T014. Add one line for core-api's `helpers/credentials/` to `packages/apis/CLAUDE.md`, and update the design page if anything changed since T022.
- [ ] T031 (human) Reviewer follows [quickstart.md](./quickstart.md) "Locally": every step, including the tampered file and the revoke and restore.
- [ ] T032 (human) After deploying to `discava-development`, follow quickstart.md "On `discava-development`": the 1EdTech validator and VerifierPlus both accept a downloaded credential and the badge image (SC-001; record what each says about the issuer); a revocation shows within 5 minutes, and after a restore the old file stays revoked while a new download is valid (SC-003); `aws kms describe-key` shows `ECC_NIST_EDWARDS25519` and the key policy names only the two roles; a download takes under 3 s (SC-004). Record the results in the PR.

---

## Dependencies and order

- PR 1 (T001 to T006) blocks everything.
- PR 2 (T007 to T011) and PR 3 (T012 to T015) need PR 1 and not each other: separate agents may write them in parallel; merge PR 2 first and rebase PR 3.
- PR 4 (US1 and US2, T016 to T022) needs PRs 2 and 3. It is the MVP.
- PR 5 (US3) and PR 6 (US4) each need PR 4 and not each other; merge in numeric order and rebase.
- PR 7 (T030 to T032) needs PRs 4 to 6.
- Within a phase, tests come first, and tasks run in ID order except those marked [P].

## Parallel examples

- After PR 1: PR 2 (core-table) and PR 3 (infrastructure) by two agents at once.
- Inside PR 4: T016 (credential builder) and T017 (status list) before T018 and T019; T022 (docs) alongside T020 and T021.
- After PR 4: PR 5 and PR 6 by two agents at once.

## Implementation strategy

MVP is PRs 1 to 4: a learner downloads a signed credential and anyone can verify it with the platform's published key and status (spec US1 and US2). Revocation is already written into the status list from PR 2, so PR 5 proves it end to end rather than adding it. PR 6 adds the badge image. Each PR runs `pnpm nx affected --target build` before it is opened and stays within its phase's files.
