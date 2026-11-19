# Feature Specification: Course Completion Certificates

**Feature Branch**: `spec/certificates` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-15

**Status**: Approved

**Input**: User description: "Issue #276: issue a verifiable certificate on course completion. Generate a certificate (PDF + shareable page) when the completion flow marks a course complete. Unique certificate ID and a public verification URL (no auth) showing learner, course, date, ID. Show/download from My Learning. Instructor can enable/disable per course."

**Parent issue**: #276

**Design page**: [`design/certificates`](../../../docs/src/content/docs/en/design/certificates.mdx)

## Clarifications

### Session 2026-11-15

Resolved without asking, using the defaults below (non-interactive run).

- Q: Is the certificate setting on or off by default, for existing courses too? → A: The setting is a required boolean on every course, on for new courses. Existing dev data is backfilled by hand, so no code treats a missing value as on.
- Q: Does turning certificates on issue them to students who already completed? → A: Not by itself (no backfill job); a later recalculation of such a student, while on, may still issue one (FR-002's repair rule).
- Q: Is the PDF stored, or drawn when asked? → A: Drawn on demand from the stored certificate; nothing in S3, so no new bucket, lifecycle or local stand-in.
- Q: What identifies a learner on a certificate? → A: Given and family name as on the user record when issued; "Discava learner" if none. Never the email.
- Q: Does disabling certificates or archiving the course hide issued certificates? → A: No; issued certificates stay verifiable and downloadable.
- Q: Can a certificate be revoked or re-issued after a name change? → A: No; out of scope until there is a real need.
- Q: Can learners hide their public verification page? → A: No; the link is unguessable and is the share mechanism.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Receive a certificate when I finish a course (Priority: P1)

A student completes every item of a course that has certificates turned on. A few seconds later (progress is recalculated shortly after the last item, as today) the course's completion also issues exactly one certificate in their name, with a unique certificate ID.

**Why this priority**: Issuing is the feature. Nothing else can be shown, downloaded or verified without it, and "exactly one, even under concurrent completion" is the rule most likely to break.

**Independent Test**: Enrol a student in a published course with certificates on, complete every item, wait for progress to settle, and check that one certificate exists for that student and course, with a unique ID, the student's name, the course title and the completion date. Run the completion recalculation twice, and concurrently: still one.

**Acceptance Scenarios**:

1. **Given** a student enrolled in a published course with certificates enabled, **When** their last item completes and the course becomes completed, **Then** one certificate is issued with a unique ID, the student's name, the course title and the completion date.
2. **Given** an issued certificate, **When** the completion is processed again (a retry, a redelivered event, or two recalculations at once), **Then** no second certificate is created and the ID does not change.
3. **Given** a course with certificates disabled, **When** a student completes it, **Then** no certificate is issued and the student's completion works exactly as before.
4. **Given** a student who completed the course earlier, **When** the instructor later adds content so the course is no longer 100% complete, **Then** their certificate is kept and stays valid (completion is permanent today).
5. **Given** a student who has dropped the course, **When** progress is recalculated, **Then** no certificate is issued.

---

### User Story 2 - Show and download my certificates from My Learning (Priority: P1)

A student opens My Learning, sees a "Certificate" action on each completed course that has one, views it, downloads it as a PDF, and copies its shareable link.

**Why this priority**: A certificate nobody can get is worthless. This is the learner-facing half of the issue and has its own e2e acceptance criterion.

**Independent Test**: With a student who holds a certificate, open My Learning, see the action on that course and none on courses without one, download the PDF, and check it contains the learner, course, date and ID.

**Acceptance Scenarios**:

1. **Given** a student with a certificate, **When** they open My Learning, **Then** the completed course shows a Certificate action beside its completion state.
2. **Given** that action, **When** the student chooses Download PDF, **Then** a PDF showing their name, the course title, the completion date, the certificate ID and the verification URL is downloaded.
3. **Given** that action, **When** the student chooses Copy link, **Then** the public verification URL is copied.
4. **Given** a student who completed a course whose certificates were off at the time and has no certificate, **Then** no certificate action is shown for it.
5. **Given** a student, **When** they request another student's certificate PDF by ID, **Then** it is refused.

---

### User Story 3 - Anyone can verify a certificate (Priority: P1)

Someone with a certificate link (an employer, a profile visitor) opens the verification page without signing in and sees the learner's name, the course, the completion date and the certificate ID. An ID that does not exist shows a clear "not found" page.

**Why this priority**: "Verifiable" is in the title and the acceptance criteria; the shareable page is also the certificate's public face.

**Independent Test**: Signed out, open the verification URL for an issued certificate and for a made-up ID.

**Acceptance Scenarios**:

1. **Given** an issued certificate, **When** an anonymous visitor opens its verification URL, **Then** they see the learner's name, course title, completion date and certificate ID, with no sign-in.
2. **Given** an unknown or malformed ID, **When** a visitor opens the URL, **Then** they see "Certificate not found", and nothing reveals which IDs exist.
3. **Given** the page, **Then** it shows no email address, user ID or progress detail: only name, course, date and ID.
4. **Given** the course was later renamed or archived, or the student later changed their name, **When** the page is opened, **Then** it still shows what was on the certificate when issued.

---

### User Story 4 - Instructor turns certificates on or off per course (Priority: P2)

On a course's settings an instructor switches "Issue a certificate on completion" on or off. It governs completions from then on.

**Why this priority**: Required by the issue, but a new course already has certificates on, so it delivers value without this.

**Independent Test**: Toggle the setting as an instructor of the course, check it persists, and check a non-instructor cannot change it.

**Acceptance Scenarios**:

1. **Given** an instructor of a course, **When** they turn certificates off, **Then** students completing the course afterwards get none.
2. **Given** certificates off, **When** the instructor turns them on, **Then** completions from then on issue certificates; students who completed while it was off are not actively backfilled (see Assumptions for when one may still arrive).
3. **Given** certificates are turned off after some were issued, **Then** the issued certificates remain visible, downloadable and verifiable.
4. **Given** a user who is not an instructor of the course, **When** they try to change the setting, **Then** it is refused.

---

### Edge Cases

- Two completions race (two Lambdas, a redelivered stream batch, a recalculation triggered by a curriculum edit at the same moment): one certificate, one ID; the loser reads the winner's.
- Issuing fails after the enrolment was marked completed: the recalculation fails as a whole and is retried like any failed stream batch, and the retry issues the certificate. Issuing never makes the learner's completion fail; if retries are exhausted, an operator re-runs the recalculation (the existing failure queue).
- A student with no name on record: the certificate carries the fallback "Discava learner"; their email is never printed.
- Very long course titles or names: the PDF shrinks or wraps them to fit one page; the web page wraps them.
- A name or title with accents, non-Latin script or emoji: issuing and download still succeed; characters the PDF font cannot draw are replaced with a visible placeholder.
- An archived course's certificates stay verifiable.
- A certificate ID with the wrong format is treated as not found without reading the table.
- Completion is permanent, so there is no re-issue or revocation flow.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When a student's enrolment in a course with certificates enabled becomes completed, the system MUST issue exactly one certificate for that student and course. Issuing MUST be idempotent: repeated, retried or concurrent attempts leave one certificate with an unchanged ID.
- **FR-002**: Issuing MUST happen whenever a progress recalculation processes a student whose enrolment is completed, certificates are enabled and none exists yet, so a failed attempt is repaired by the retried recalculation. Turning certificates on later does not run a backfill job (see Assumptions).
- **FR-003**: Each certificate MUST have a unique, unguessable ID, safe to print and type (no ambiguous characters), and MUST record the learner's name, the course title and the completion date (the enrolment's completion date) as they were when issued.
- **FR-004**: A certificate's recorded learner name, course title and date MUST NOT change when the course or the user is later edited.
- **FR-005**: Dropped students MUST NOT be issued a certificate.
- **FR-006**: Anyone, without signing in, MUST be able to look up a certificate by its ID and see the learner's name, course title, completion date and ID. The response MUST carry nothing else about the learner, and an unknown ID MUST look the same as a malformed one.
- **FR-007**: The student portal MUST serve a public verification page at a stable URL containing the certificate ID, which is also the shareable link.
- **FR-008**: A signed-in student MUST be able to list their own certificates and download a PDF of any of them, and MUST NOT be able to read another student's. The PDF MUST show the learner, course, date, certificate ID and verification URL.
- **FR-009**: My Learning MUST show a Certificate action on each completed course that has a certificate, offering view, PDF download and copy-link, and no action on courses without one.
- **FR-010**: Instructors of a course MUST be able to enable or disable certificates for it; it is a required setting, on for new courses. The setting MUST be changeable only by that course's instructors and MUST only affect completions processed afterwards; it never removes issued certificates.
- **FR-011**: Issued certificates MUST remain verifiable and downloadable regardless of later course status (archived), the setting, or the student's later activity.
- **FR-012**: Certificate writes MUST go through one shared `core-table` helper, and an invariant check that a test can break MUST cover that there is at most one certificate per student and course, that each matches an enrolment that is completed, and that its recorded course matches an existing course.
- **FR-013**: The feature MUST work end to end in local development without an AWS account, including issuing, PDF download and public verification.
- **FR-014**: The feature MUST NOT add email delivery, social-share integrations, revocation, custom templates or instructor signatures (see Assumptions).

### Key Entities

- **Certificate**: One per student per course. Has the certificate ID, the student, the course, the learner name, course title and completion date as printed, and when it was issued. Looked up by ID (public verification), by student (My Learning), and by student and course (idempotent issuing).
- **Course certificate setting**: A required per-course on/off flag, on for new courses, edited by the course's instructors.
- **Enrolment**: Existing. Its completed status and completion date are the trigger and the source of the certificate's date.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of runs, however many times and however concurrently a completion is processed, a student has exactly one certificate per course completed with certificates enabled, and the data-consistency check passes after every test.
- **SC-002**: A student who completes a course sees its certificate in My Learning within 30 seconds of the last item, and the PDF downloads in under 10 seconds.
- **SC-003**: A signed-out visitor can verify a certificate in one page load, and sees only name, course, date and ID.
- **SC-004**: 0 cases where a student can download or list another student's certificate.
- **SC-005**: 100% of completions in certificate-disabled courses issue none; 100% of certificates issued before a disable remain verifiable afterwards.
- **SC-006**: Certificate IDs cannot be guessed: each carries at least 80 bits of randomness, and the public lookup offers no way to list or search them.

## Assumptions

- Issuing happens where completion is decided (the progress recalculation that marks an enrolment completed), not in the request that completes the last item, so a learner's completion never fails because of a certificate. The certificate appears with the same few seconds' delay as completed progress.
- The setting is required on every course and starts on for new courses. Existing courses are backfilled by hand before this ships, so there is no "absent" state and no code reads a missing value as on.
- No backfill job: turning certificates on does not issue anything by itself. Because issuing is attempted whenever a completed student's progress is recalculated while certificates are on (FR-002), a student who completed while they were off may still receive one the next time their progress is recalculated (for example after the instructor edits visible course content). Students are never told to expect it. A deliberate one-off backfill is a follow-up.
- A learner's name is the user record's given and family names joined by a space; if neither is present, "Discava learner". Learners cannot edit the printed name in this feature.
- The PDF is a fixed, single-page, English-language design with no instructor signature, rendered on demand from the stored certificate. Nothing is stored in S3.
- IDs carry at least 80 bits of randomness; public lookup relies on that and on the existing WAF, not on separate rate limiting.
- Verification is public by design: the page exposes the learner's name to anyone holding the link. Learners cannot hide a certificate in this feature.
- Out of scope: revocation, expiry, re-issue after a name change, emailing certificates, "add to profile" integrations, multiple languages or designs, QR codes, instructor signatures, admin portal views, bulk backfill.
- Discava has not launched: no old data or URLs to preserve, so the course setting and routes are added outright.
- Only the final implementation PR may close #276.
