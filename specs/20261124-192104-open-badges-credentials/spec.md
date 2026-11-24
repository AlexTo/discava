# Feature Specification: Certificates as Open Badges 3.0 Verifiable Credentials

**Feature Branch**: `20261124-192104-open-badges-credentials` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "Open Badges 3.0 / verifiable credentials. Certificates become signed, portable credentials."

**Parent issue**: none (open a tracking issue before Phase 1; see `tasks.md`)

**Design page**: [`design/certificates`](../../docs/src/content/docs/en/design/certificates.mdx) (gains a "Verifiable credentials" section)

## Clarifications

### Session 2026-11-24

Resolved without asking, using the recommended defaults (non-interactive run). Each is listed again under "Decisions to confirm" in the pull request.

- Q: Who is named as the issuer of the credential: the platform, the instructor or the course? → A: The platform (this deployment), under the name an administrator set on the Branding page, as for LinkedIn sharing. Instructors are not issuers. The course appears as the achievement.
- Q: How is the learner identified inside the credential, given there is no wallet sign-up today? → A: By the name printed on the certificate, and by a salted one-way hash of the email address on their account the first time the credential is downloaded, fixed from then on, so a verifier who is told the learner's email can confirm it matches. The email itself never appears. A learner identifier from a digital wallet is out of scope.
- Q: Do certificates issued before this ships get a credential? → A: Yes. Every certificate, whenever it was issued, can be downloaded as a credential, built from what the certificate recorded at issue. Discava hasn't launched, so this costs nothing to keep compatible.
- Q: Does a credential expire? → A: No. Certificates have no expiry today, and the credential has none either. Revocation is the only way it stops being valid.
- Q: Which files does the learner get? → A: Two: the credential itself (a JSON file, the form wallets and verifiers import) and an SVG badge image with the same credential embedded in it (the form badge backpacks accept). SVG rather than PNG, because it shows the course title in any script without a server-side image renderer (research R-9). The PDF stays as it is.

## User Scenarios & Testing *(mandatory)*

A learner who earns a certificate today gets a public verification page, a PDF and a LinkedIn shortcut (certificates spec #276, criteria and revocation, LinkedIn sharing #592). All three depend on Discava: the PDF proves nothing on its own, and checking it means visiting Discava's page. Open Badges 3.0, the 1EdTech standard built on W3C Verifiable Credentials, lets an issuer sign a credential so that anyone can check it, with any conforming verifier, long after it was downloaded and without asking the issuer's website to vouch for it. This feature makes every Discava certificate available in that form.

### User Story 1 - Download my certificate as a verifiable credential (Priority: P1)

A learner with a certificate opens My Learning. Beside View, Download PDF, Copy link and Add to LinkedIn profile there is "Download credential". It saves a file the learner can keep, import into a digital credential wallet or hand to an employer. The file states that the platform issued the learner a credential for completing the course on the completion date, carries the certificate ID and the address of the public page, and is signed by the platform. The same action is on the certificate's public page when the signed-in viewer is its owner.

**Why this priority**: This is the feature. Without a signed, portable file there is nothing for anyone to verify or carry elsewhere.

**Independent Test**: As a learner with a certificate, choose "Download credential" in My Learning, then check the file with a conforming Open Badges 3.0 verifier: it reports a valid signature from the platform, the course title, the completion date and the certificate ID. Open the public page as the owner, as another signed-in user and signed out: only the owner sees the action.

**Acceptance Scenarios**:

1. **Given** a learner with a valid certificate, **When** they choose "Download credential" in My Learning, **Then** a file is saved whose name includes the certificate ID, and a conforming verifier reports it as a valid Open Badges 3.0 credential issued by the platform.
2. **Given** the downloaded file, **When** anyone reads it, **Then** it shows the learner's name, the course title as printed on the certificate, the completion date, the certificate ID, the address of the public page, the statement of what was assessed, and the platform as issuer with its name, address and logo.
3. **Given** the downloaded file, **When** any character of its signed content is changed, **Then** a conforming verifier reports the signature as invalid.
4. **Given** the certificate's owner is signed in, **When** they open its public page, **Then** the page offers "Download credential" with the same result.
5. **Given** a signed-out visitor, or a signed-in user who isn't the owner, **When** they open the public page, **Then** there is no download action, and no way to obtain the credential except from the learner.
6. **Given** a revoked certificate, **Then** My Learning and the public page offer no "Download credential", and asking for it is refused with "This certificate has been revoked".
7. **Given** the course is renamed, archived, or has certificates turned off after the certificate was issued, **When** the learner downloads the credential, **Then** it carries what the certificate recorded at issue and is still valid.

---

### User Story 2 - Check a credential without trusting the file (Priority: P1)

An employer, another school or a wallet receives a credential file. Without a Discava account, and without the learner's help, it can find out who issued the credential, fetch the issuer's published details and public key from the platform's own address, and confirm the signature. It can also see whether the certificate is still valid. The checks work with conforming verifiers that 1EdTech and others publish, not only Discava's own page.

**Why this priority**: A signature is only useful if a stranger can check it. Stories 1 and 2 together are the minimum that delivers "signed, portable credentials", and they ship together.

**Independent Test**: Take a downloaded credential to a conforming verifier on another network. It fetches the issuer's details and key from the platform, and reports the credential as valid and not revoked. Repeat for a credential signed by a different key, or by a tampered issuer address: it reports the credential as invalid.

**Acceptance Scenarios**:

1. **Given** a credential, **When** a verifier looks up the issuer named in it, **Then** the platform answers at that address, signed out, with the issuer's name, address, image and the public key or keys that verify its credentials.
2. **Given** a credential, **When** a verifier checks its status, **Then** the platform answers, signed out, that it is valid.
3. **Given** the credential's signing key is no longer the one the platform signs new credentials with, **When** a verifier checks an older credential, **Then** it still verifies, because the platform keeps publishing every key it has signed with.
4. **Given** someone signs a file with another key and names the platform as issuer, **When** a verifier checks it, **Then** it is reported as invalid.
5. **Given** a verifier looks up the issuer, the status or the key, **Then** the answers name no learner, email address, account or score, and say nothing about other credentials beyond whether each listed one is revoked.

---

### User Story 3 - A revoked certificate's credential stops verifying (Priority: P2)

An instructor or administrator revokes a certificate, as they can today. From then on, any verifier checking that certificate's credential, including copies downloaded before the revocation, is told it has been revoked. If the certificate is restored, the same credential verifies as valid again.

**Why this priority**: Without it, revoking a certificate would leave a valid-looking signed copy in circulation forever, which is worse than today's PDF because the signature makes it look trustworthy. It ships right after the MVP and before the feature is announced.

**Independent Test**: Download a credential, revoke the certificate as its instructor, wait five minutes and check the credential with a conforming verifier: it reports the credential as revoked. Restore it as an administrator, wait five minutes and check again: it is valid.

**Acceptance Scenarios**:

1. **Given** a credential downloaded while the certificate was valid, **When** the certificate is revoked, **Then** within 5 minutes a verifier checking the credential reports it as revoked.
2. **Given** a revoked certificate, **When** it is restored, **Then** within 5 minutes the same credential, unchanged, verifies as valid again.
3. **Given** a revoked certificate, **When** a verifier checks its status, **Then** it learns only that the credential is revoked: not the reason, who revoked it, or any note.
4. **Given** two certificates, one revoked, **When** a verifier checks the other, **Then** it is reported as valid.

---

### User Story 4 - A badge image that carries the credential (Priority: P3)

Beside "Download credential", the learner can choose "Download badge image". It saves an image showing the platform's logo or icon, the course title and the completion date, with the same signed credential embedded inside, so badge backpacks and profiles that accept Open Badges images can read and verify it from the image alone.

**Why this priority**: Useful for sites that take images rather than JSON files, but the JSON credential already makes the certificate portable and verifiable.

**Independent Test**: Download the badge image, open it in an image viewer (it shows the badge) and give it to a conforming verifier that reads embedded credentials: it finds and verifies the same credential as Story 1.

**Acceptance Scenarios**:

1. **Given** a valid certificate, **When** the learner chooses "Download badge image", **Then** an SVG image is saved that shows the platform's brand, the course title and the completion date.
2. **Given** that image, **When** a conforming verifier reads it, **Then** it extracts the embedded credential and reports it valid, issued by the platform, for that certificate.
3. **Given** a revoked certificate, **Then** no badge image is offered, as in Story 1.

---

### Edge Cases

- **Course title, learner name or brand changes after issue**: the credential carries the learner name and course title recorded at issue. The issuer's name and logo are what the platform publishes now, as for any issuer that renames.
- **Characters outside Latin-1** (Chinese, emoji): the credential and the badge image carry them exactly, unlike the PDF. The image is drawn by the viewer's fonts.
- **A certificate issued under a criteria version that has since changed**: the credential describes the criteria the certificate was issued under, as the public page does.
- **The learner changes their account email later**: the hash in the credential stays the one fixed at the first download. A verifier given the new address won't match it; the learner's name and the public page still identify the certificate.
- **The learner has no email on their account**: the credential identifies them by name only.
- **The signing service is unavailable**: the download fails with a retryable error message, and nothing about the certificate changes. The status, issuer and key lookups keep answering, because they need no signature at request time.
- **Downloading again**: each download returns a credential with the same content and identifier. Its signature bytes may differ, and every copy verifies.
- **A certificate ID that is malformed or unknown**: status and credential lookups answer "not found", the same for both, as the public page does.
- **Several stages**: each deployment signs with its own key and names itself at its own address. A credential from one stage does not verify as issued by another.
- **Local development**: downloads, verification lookups and revocation work under local dev, signed with a local key that no deployed stage trusts.

## Requirements *(mandatory)*

### Functional Requirements

**The credential**

- **FR-001**: The system MUST let a certificate's owner download it as an Open Badges 3.0 credential (an achievement credential conforming to 1EdTech Open Badges 3.0 and W3C Verifiable Credentials) from My Learning and from the certificate's public page when the signed-in viewer is the owner.
- **FR-002**: The credential MUST name the platform as issuer, with the name, address and image the platform publishes for itself; instructors and courses MUST NOT be issuers.
- **FR-003**: The credential MUST describe the achievement as completing the course, with the course title, a description, and criteria taken from the certificate's assessment statement, all as recorded on the certificate at issue.
- **FR-004**: The credential MUST identify the learner by the name printed on the certificate and, when their account has an email address the first time the credential is built, by a salted one-way hash of it, fixed on the certificate from then on, in the standard's identity form; it MUST NOT contain the email address in readable form, the learner's account ID or any session value.
- **FR-005**: The credential MUST carry a stable identifier derived from the certificate, the certificate ID, the address of the public page, the completion date as the date it became valid, and no expiry.
- **FR-006**: The credential MUST be signed by the platform in a proof format the Open Badges 3.0 specification defines, so that conforming verifiers can check it; changing any signed content MUST make verification fail.
- **FR-007**: The credential MUST NOT include the per-item scores or the list of assessed items kept on the certificate. It MAY include the statement of what was assessed, as the public page shows.
- **FR-008**: Downloading MUST be refused for a revoked certificate with "This certificate has been revoked", and for any certificate the caller doesn't own with the same answer as a certificate that doesn't exist.
- **FR-009**: Every certificate, including those issued before this feature, MUST be downloadable as a credential built from what it recorded at issue.

**Verification**

- **FR-010**: The platform MUST publish, at a stable address it names as the issuer's identifier, the issuer's details and every public key it has used to sign credentials, readable without signing in.
- **FR-011**: Each credential MUST point to a status the platform publishes, readable without signing in, that says whether that credential is revoked; the status MUST follow the certificate's revoked state within 5 minutes of a revoke or restore.
- **FR-012**: The published issuer details, keys and status MUST NOT reveal learner names, emails, account IDs, scores, revocation reasons, notes or who acted.
- **FR-013**: The platform MUST keep publishing a key for as long as any credential signed with it may be presented, so retiring a signing key never invalidates credentials already issued.
- **FR-014**: The private signing key MUST never leave the platform's managed key service on a deployed stage: no person, API response, log or file holds it. Only the function that builds credentials may use it.
- **FR-015**: Each deployed stage MUST sign with its own key and publish under its own address.

**Badge image**

- **FR-016**: The system MUST let the owner of a valid certificate download an SVG badge image showing the platform's brand, the course title and the completion date, with the same signed credential embedded in it as the Open Badges 3.0 specification defines for images.

**Surfaces and limits**

- **FR-017**: My Learning and the owner's view of the public page MUST show "Download credential" and "Download badge image" for a valid certificate, with text-only buttons, and hide both for a revoked one.
- **FR-018**: The public page MUST say, for a valid certificate, that it is also available as a verifiable credential the owner can download; it MUST NOT offer the file to anyone but the owner.
- **FR-019**: The certificates design page and the learner help MUST explain what the credential is, how to verify one and what revocation does to it.
- **FR-020**: Every flow above MUST work under local development without an AWS account, signing with a local key.
- **FR-021**: Revoking or restoring a certificate MUST keep working as today; the credential status follows it without a second action by the instructor or administrator.

### Key Entities

- **Verifiable credential**: the signed file built from a certificate. It holds the issuer, the achievement (the course), the learner's identity (name and hashed email), the dates, the certificate ID and address, a pointer to its status and the signature. It is built when asked for, from the certificate.
- **Certificate** (existing): gains, the first time its credential is built, the learner's hashed identity and its place in the published status, both fixed from then on, so every later download describes the same credential.
- **Issuer profile**: the platform as a credential issuer: its name, address, image and the public keys it signs with. One per deployment, published at a stable address.
- **Signing key**: a private key held in the platform's key service. One is current; earlier ones stay published so their credentials keep verifying.
- **Credential status**: what the platform publishes about whether a credential is revoked, derived from the certificate's revoked state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A credential downloaded from a deployed stage passes the 1EdTech Open Badges 3.0 validator and at least one other independent conforming verifier with no errors.
- **SC-002**: In tests, every one-character change to a credential's signed content is reported invalid (100%).
- **SC-003**: A revoke or restore is reflected by the status a verifier reads within 5 minutes, in every test.
- **SC-004**: A learner can download their credential or badge image in under 3 seconds from choosing the action.
- **SC-005**: No credential, issuer profile, key set or status contains a readable email address, an account ID or a per-item score (checked by automated tests on every field).
- **SC-006**: Every story's independent test passes under local development with no AWS account.

## Assumptions

- The platform name, logo and icon are the ones an administrator sets on the Branding page; until one is set, the Discava defaults are used.
- The student portal's public address is the platform's public address for issuer, status and key lookups. A stage with a custom domain uses it; one without uses its default CloudFront address. Moving a stage to a new address later is treated like a rename: credentials already issued keep pointing at the old address, which is acceptable before launch (constitution VII).
- Digital wallets that import by link or QR code, wallet-held learner identifiers, credentials for anything other than course completion (skills, learning paths, assignments), endorsements, and an in-Discava "verify a file" page are out of scope. They can build on this feature later.
- Signing-key rotation is done by an operator through the deployment; a self-service rotation screen is out of scope.
- The certificate PDF, the LinkedIn action and the certificate emails are unchanged.
