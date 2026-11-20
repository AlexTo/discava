# Research: Certificate Criteria, What Was Assessed, and Revocation

Decisions made while planning, each with what was rejected. File and function names are the ones in the repository on 2026-11-20.

## R-1: Completion stays as it is; the criteria gate only the certificate

**Decision**: An enrolment still becomes `completed` when every effectively visible item has an `itemCompletion`, and a quiz item still completes when it is passed or its attempts are used up ([progress and completion](../../docs/src/content/docs/en/design/progress-and-completion.mdx)). `recalculateStudent` (`packages/events/src/progress/recalculate.ts`) keeps writing that exactly as today. What changes is its last step: it calls `issueCertificate` only when the course's criteria are also met.

**Rationale**: `completed` already has readers that must not change meaning: the refund period (a student cannot ask for a refund after completing, checkout spec FR-033 as amended), My Learning, the analytics funnel, `completed-at-iff-completed` and `certificate-has-completed-enrolment`. Completion is also permanent, and criteria can change, so tying the two would mean either un-completing students or completing them late.

**Alternatives**: Make a quiz item complete only when passed (changes progress for every course, whatever its criteria, and leaves a student out of attempts stuck below 100% for ever). A second status on the enrolment such as `qualified` (a second concept every reader would have to learn; the certificate record already says it).

**Consequence**: "completed, no certificate" becomes a normal, lasting state. The course home explains it (spec User Story 2).

## R-2: Where criteria live and how they are versioned

**Decision**: A required map on the `course` record, `certificateCriteria: { version, requireQuizPass, minUploadScorePercent? }`, beside `certificatesEnabled`. A new course gets `{ version: 1, requireQuizPass: false }`. `setCertificateCriteria` in core-table is its only writer after creation: it writes the new values and adds one to `version`, only when something changed, and moves `updatedAt` as other course edits do. There is no history of past criteria.

"Certificates already issued keep the criteria that applied when they were issued" is kept by copying, not by reference: the certificate records the criteria it was issued under, with their `version`, in its `assessment` (R-3). Nothing ever reads the course's criteria to describe an issued certificate.

**Rationale**: It is the pattern the certificate already uses for the learner's name and the course title (snapshot, not join). The course record is already read at the moment of issue (`recalculateStudent` gets it for the title and the switch), so the criteria arrive with a read that happens anyway, and they are read at the same instant as the decision they govern. The version number costs nothing and lets the certificate, the logs and a future audit say which change a certificate was issued under.

**Alternatives**:

- A `certificateCriteria` entity with one record per version, and a version number on the certificate. Two reads to describe a certificate, a new entity and collection, and a rule that old versions are never deleted, for a history nobody has asked to browse. Worth revisiting if criteria grow beyond two settings.
- Criteria per assessed item ("this quiz counts towards the certificate"). More expressive, but it moves the decision into every quiz editor and makes "what does the certificate require" a query over the curriculum. The issue asks for a course-level choice.
- A course-level pass mark that overrides each quiz's. Conflicts with `quizSummary.passedAt`, which is set against the quiz's own pass mark and never cleared.

## R-3: What is copied onto the certificate, and why nothing finer

**Decision**: `certificate.assessment`, a required, read-only map written by `issueCertificate`:

| Field | Meaning | Shown publicly |
|-------|---------|----------------|
| `criteriaVersion`, `requireQuizPass`, `minUploadScorePercent?` | the criteria in force | the two settings, in words |
| `itemCount` | effectively visible items in the course at issue | yes |
| `assessedItemCount` | assessed items that a criterion required | yes |
| `passMarkLowest?`, `passMarkHighest?` | lowest and highest pass mark among assessed quizzes | yes (one figure when equal) |
| `scoreBand?` | lower bound of the ten-point band (0, 10 … 90; 90 means 90 to 100) | yes |
| `courseHours?` | `course.durationHours` at issue | yes |
| `assessedItems` | `{ contentItemId, kind, scorePercent, passMarkPercent? }` per assessed item | **never** |

The band is `min(90, floor(mean(scorePercent) / 10) * 10)`, each assessed item weighing the same. `scorePercent` is the student's `quizSummary.bestScore` at that moment (for a graded upload, `floor(points / maxPoints * 100)`).

**Rationale for a band and no detail**:

- The issue asks for it, and a verifier needs "what did this take", not a transcript.
- An exact score invites comparison between two holders of the same certificate that the data cannot support: quizzes can be retaken, and `bestScore` only rises.
- Per-quiz and per-question detail would publish the course's assessment structure and, with a small course, effectively the learner's answers.
- The public page is readable by anyone with the link; the less it says about a named person, the better (constitution VI).

**Why `assessedItems` is stored at all**: it is what makes the issue's invariant checkable. "A certificate exists only for an enrolment that met the criteria in force at issue" cannot be checked against the current curriculum, which changes. With the list, the check can confirm that each listed quiz has a `quizSummary` for the student that was passed no later than `issuedAt`, and that the counts, pass marks and band on the certificate follow from the list. No API returns it; output schemas are fixed projections, with a test that the public output has no other keys (as `certificate.verify` has today).

**When nothing was required**: with `requireQuizPass: false` and no upload criterion, `assessedItemCount` is 0, `assessedItems` is empty, and the pass marks and band are absent. The statement says so. Showing the score of quizzes nobody had to pass was rejected: a low band would shame a learner for something that was not a condition, and a high one would claim an assessment the course did not make.

**Alternatives**: Compute the statement on read from current data (drifts as the course changes, breaking FR-015). Store the PDF (rejected in #276 for the same reasons; the PDF stays a pure function of the record).

## R-4: One rule, two readers

**Decision**: `evaluateCertificateCriteria({ criteria, curriculum, quizSummaries, submissions? })` in `core-table/src/helpers/certificate-criteria.ts`, a pure function over data both callers already load. It returns `met`, the per-requirement progress the course home shows, and the `assessment` fields to copy. The recalculation passes its result to `issueCertificate`; core-api's `certificate.requirements` returns its per-requirement part.

**Rationale**: constitution IV's "shared helper every writer calls", applied to a reader too: if the page and the issuer computed "met" separately they would disagree at the edges (hidden quizzes, zero pass marks, archived lessons). `filterEffectivelyVisible` already defines what a student can see and is reused.

**Assessed quiz**: a `contentItem` of `type: 'quiz'` that is effectively visible with `settings.passMarkPercent > 0`, whether its lesson is an ordinary lesson or of `kind: 'assignment'`. Passed means its `quizSummary.passedAt` is set.

## R-5: What makes a waiting certificate arrive

Today the progress recalculation runs for a new `itemCompletion` and for a visibility change to a module, lesson or item (`PROGRESS_STREAM_FILTERS`). Three more events can now make a student qualify:

| Event | Why the existing triggers miss it | Decision |
|-------|-----------------------------------|----------|
| A quiz is passed after its item was already complete (attempts used up, limit raised, passed on a later attempt) | no `itemCompletion` is inserted | filter gains `quizSummary` INSERT and MODIFY; the handler acts only when `passedAt` appears; recalculates that one student |
| The criteria change, or certificates are turned on | a `course` record is not a curriculum entity | filter gains `course` MODIFY; the handler acts only when `certificateCriteria.version` or `certificatesEnabled` differs between the old and new image; recalculates every enrolled student who has not dropped |
| A graded upload is returned or regraded (Phase 8) | not a completion | filter gains `assignmentSubmission` MODIFY; the handler acts when `status`, `points` or `returnedAt` changed; that one student |

**Rationale**: a stream filter cannot compare images, so the handler already discards curriculum edits that change nothing students see (`changesWhatStudentsSee`); the new cases follow the same shape. Every quiz attempt and every course edit now reaches the handler, which discards most of them after comparing two fields: one cheap invocation per attempt, already batched for five seconds.

**This changes #276**: its spec ran no backfill when certificates were turned on. With a course home that says "every requirement met", a certificate that only arrives "the next time progress is recalculated" would look broken, so the switch now triggers the same pass as a criteria change. It costs one keyed read per enrolled student who already has a certificate and a few more for one who does not, the same order as a curriculum change. The design page's "Limitations" loses its first bullet.

**Alternatives**: A recalculation requested directly by instructor-api (a second trigger path, and the instructor's request would wait on or fan out the work). A nightly sweep (minutes-to-hours delay against a 30-second promise, and a scan).

## R-6: Changing criteria on a live course

**Decision**: The criteria read when a student is evaluated apply. No per-enrolment copy, no grace period.

- A student who already holds a certificate is untouched: nothing reads the course's criteria for an issued certificate, and `issueCertificate` returns an existing record before looking at anything else.
- Loosening issues certificates to everyone it makes qualify (R-5).
- Tightening affects only students who have not qualified yet. A student who had qualified already has the certificate, because issue follows qualification within seconds.
- The instructor's control says this before saving; the course home shows current requirements.

**Race**: the recalculation reads the course once and copies what it read. A change landing between that read and the write produces a certificate issued under the previous version, recorded as such. That is correct by the rule "in force at issue" and visible in `criteriaVersion`.

**Alternatives**: Copy the criteria onto the enrolment at enrol time (each student held to the version they saw; the course home, the evaluation and support all become per-student, and an instructor fixing a mistake in the criteria could not fix it for anyone enrolled). A dated change with notice (needs scheduling and messaging for a setting most courses will set once).

## R-7: Who may revoke, the record kept, and undoing it

**Decision**:

- **Instructor of the course**: lists the course's certificates and revokes one with reason `academic-integrity`, `issued-in-error` or `other`.
- **Administrator**: looks up any certificate by ID and revokes with any of those or `refunded`.
- **Nothing automatic** (R-8).
- **Restore**: an administrator always; an instructor only when `revokedByRole` is `instructor`.
- **Record**: the certificate carries its current state (`revokedAt`, `revocationReason`, `revokedByRole`); each change also appends a `certificateEvent` (`revoked` or `restored`, actor, role, reason, note, time) in the same transaction. `revokeCertificate` and `restoreCertificate` in `core-table/src/helpers/certificate.ts` are the only writers of both, and both APIs call them.

**Rationale**: the instructor is who knows about copied work or a mistake in their own course; the administrator is who handles payments and reports from outside. Keeping the state on the certificate means the public lookup and the PDF check stay one keyed read. Keeping the events separately means a revoke, restore and second revoke leave three facts, not one overwritten field; the invariant ties the two together.

**Idempotence and races**: the certificate patch is conditioned on the state it expects (not revoked, for a revoke), so of two simultaneous revokes one transaction is cancelled and returns the stored state: one event.

**Re-issue**: none. `issueCertificate` returns the existing record whatever its status, and the recalculation stops as soon as it finds one, so a revoked certificate is never replaced.

**Notification**: after the transaction, the helper publishes `certificate.revoked` or `certificate.restored` through `publishNotification`, with a dedupe key made from the certificate ID and the event time, so a retried request sends one.

**Alternatives**: Administrators only (instructors would need to ask the platform to act on their own course's integrity cases; the reviews feature already trusts instructors and admins with moderation). Delete the certificate (loses the audit trail, makes the ID "not found", and lets the next recalculation issue a fresh one). State only in the event log (every public lookup would need a query for the latest event).

## R-8: Refunds: the decision for the maintainer

The checkout spec says: "Certificates survive refunds. … Revoking certificates on refund is a decision for the maintainer and out of scope here", and widened `certificate-has-completed-enrolment` so a `dropped` enrolment that keeps its `completedAt` satisfies it. Its 2026-11-19 amendment stops a student asking for a refund after completing the course.

**Recommended default (what this spec specifies): do not revoke automatically.**

- After the amendment, a refund to a student who holds a certificate can only come from an operator refunding in Stripe. Those are judgement calls: goodwill, a broken course, a disputed charge. Only the last is a reason to withdraw a certificate the student earned.
- An administrator revokes with reason `refunded` when it is warranted. One extra action in a rare case, taken by the person who made the refund.
- Nothing in the checkout spec, its tasks or its invariants changes. `certificate-has-completed-enrolment` stays widened: a refunded student's certificate, valid or revoked, still has a `dropped` enrolment with the same `completedAt`.

**Alternative: revoke on every full refund.** What it would take, should the maintainer choose it:

- `refundOrder` (`core-table/src/helpers/order.ts`) adds the revocation to its transaction, through a `revokeCertificateWrites` function, with actor role `system` and reason `refunded`; partial refunds do nothing.
- Buying the course again (`settleOrderPaid`) restores a certificate whose last revocation was `system`/`refunded`; one revoked by a person stays revoked.
- A new invariant, `refunded-enrolment-has-no-valid-certificate`: a certificate whose enrolment is `dropped` and whose order is `refunded` must be revoked. `certificate-has-completed-enrolment` stays as widened (the record still exists).
- Leaving a free course (`unenrolFromCourse`) would still keep the certificate, so "dropped" alone could not be the trigger.
- The checkout spec would need an amendment: its Clarifications (two answers), User Story 4 scenario 5, FR-015, the "Certificates survive refunds" assumption and e2e task T061 ("the certificate still verifies") all state the opposite.
- One more phase here (about six tasks), after Phase 6.

It was not chosen as the default because it would silently reverse a decision another spec made and the maintainer confirmed on 2026-11-20 (checkout T113), and because it treats a goodwill refund like fraud.

## R-9: What the public page shows for a revoked certificate

**Decision**: `certificate.verify` returns one of two shapes. Valid: today's fields plus the statement. Revoked: `{ status: 'revoked', certificateId, revokedAt, revokedOn }` and nothing else. The page says "This certificate has been revoked and is no longer valid", with the ID and the date.

**Rationale**: "revoked" next to a name reads as misconduct whatever the real reason, and the page is public. A verifier is always holding something that names the learner (the PDF, a profile entry, an email) and needs one answer: is this ID still good. The ID and the date give it. The reason and the actor stay internal (FR-019, FR-021). The response stays distinct from "not found" because the issue requires the page to say revoked, and because an ID that used to verify and now "does not exist" would look like a platform fault.

**Does this reveal that an ID exists?** Only to someone who already has the ID; IDs keep their 80 bits and there is still no public listing.

**Alternatives**: Show the name and course with a revoked banner (publishes a negative fact about a named person to anyone with the link). Return "not found" (fails the acceptance criterion and misleads). Show the reason (leaks a refund or an integrity finding).

**The PDF**: `certificate.pdf` refuses a revoked certificate with `PRECONDITION_FAILED` and the message "This certificate has been revoked". A PDF already downloaded cannot be recalled; it prints the verification address, and the page is the truth.

## R-10: New and widened invariants

All in `core-table/src/helpers/invariants/certificates.ts`, each with breaking tests.

| Invariant | New or widened | Rule |
|-----------|----------------|------|
| `certificate-shape` | widened | also: `assessment` is present with `criteriaVersion >= 1`, `itemCount >= 1`, `assessedItemCount` equal to the length of `assessedItems`; pass marks and band are present exactly when `assessedItemCount > 0`; the band is a multiple of 10 from 0 to 90 and equals the band of the listed scores; `passMarkLowest <= passMarkHighest`; `revokedAt`, `revocationReason` and `revokedByRole` are all set or all absent; `revokedAt >= issuedAt` |
| `certificate-met-criteria` | new | the issue's rule. If `assessment.requireQuizPass`, every listed quiz has `scorePercent >= passMarkPercent > 0` and the student has a `quizSummary` for it with `passedAt <= issuedAt` and `bestScore >= scorePercent`; if not, and there is no upload criterion, the list is empty. Phase 8 adds: every listed upload has `scorePercent >= minUploadScorePercent` and the student has a submission for it |
| `certificate-status-matches-history` | new | a certificate is revoked exactly when its latest `certificateEvent` is `revoked`, with the same time, reason and role; every event names an existing certificate, alternates `revoked` and `restored` starting with `revoked`, and has an actor; `refunded` is used only by role `admin`; reason `other` has a note |
| `course-certificate-criteria-shape` | new | every course has `certificateCriteria` with an integer `version >= 1` and, when present, `minUploadScorePercent` from 1 to 100 |
| `certificate-has-completed-enrolment` | **unchanged** | still accepts `completed`, or `dropped` with the same `completedAt` (checkout's widening). New tests pin that it holds for a revoked certificate and still fails for an `active` enrolment |
| `instructor-course-updated-at` | unchanged | `setCertificateCriteria` moves `updatedAt` through `refreshInstructorCourseUpdatedAt`; its test is extended |

Not violations, each pinned by a test: a completed enrolment with no certificate; a certificate whose `assessment` differs from the course's current criteria; a certificate listing a quiz that has since been hidden, archived or had its pass mark raised; a revoked certificate in a course with certificates on.

`certificateEvent` joins `TableSnapshot` and `SNAPSHOT_ENTITIES`, and `quizSummaries` is already loaded for the student-activity checks (confirmed at implementation; added if not).

## R-11: Listing a course's certificates

**Decision**: a `byCourse` index on the certificate, on the existing `gsi2pk-gsi2sk-index` (`gsi2pk` = `courseId`, `gsi2sk` = `issuedAt`, `userId`), queried newest first, 50 per page. The entity's own key prefix keeps it apart from the other three users of that index; a `.params()` test proves it, as #276 did for `gsi1`.

**Rationale**: the certificate's primary key is by student, so "a course's certificates" has no key today, and an instructor acting on an integrity case knows the student, not the ID. Constitution V allows an index for a named access pattern; this reuses a provisioned one, at one more index write per certificate.

**Alternatives**: Revoke by pasted ID only (instructors rarely have it). Scan (forbidden in a user request). Walk the course's enrolments and get each certificate (one read per student per page).

## R-12: Wording shared by the page and the PDF

**Decision**: `assessmentStatement(assessment)` in `core-api/src/helpers/certificate-statement.ts` returns the statement as English lines. `certificate.verify` returns them as `statement: string[]`, and `certificate.pdf` draws the same lines. The page prints what it is given.

**Rationale**: FR-013 asks for the same words in both; `verify` already returns a date formatted for print (`completedOn`) for the same reason. The portals have no translations today.

Lines, in order, each only when it applies:

1. "Completed all 14 items of the course."
2. "Passed 3 assessed quizzes. Pass mark: 70%." (or "Pass marks: 60% to 80%."; "1 assessed quiz")
3. "Graded assignments returned with at least 60%: 2." (Phase 8)
4. "Overall score: 80–89%." ("90–100%" for the top band)
5. "No graded assessment was required for this certificate." (instead of 2 to 4)
6. "Course length: 12 hours."

## R-13: The graded-upload criterion and #102 part 3

**Depends on** (from issue #102, section 3, not built): `assignmentSubmission.points` (0 to the item's `maxPoints`), `returnedAt`, `returnedBy`, the `returned` status being written, and "return and reopen for another upload".

**Decision**: Phase 8, last, so no earlier phase waits on it. Its first task is a **(human)** check that part 3 is merged and that its shape matches; its tasks are written against the names above and are to be revised if part 3 lands differently. Until then `minUploadScorePercent` is not in any input schema and no UI shows it (FR-031).

An upload assignment meets the criterion when its submission is `returned` and `floor(points / maxPoints * 100) >= minUploadScorePercent`. A submission reopened for another upload is `submitted` again and does not count until returned again.

**Open, for whoever specifies part 3**: a student returned below the threshold with the work locked has no way to the certificate unless the instructor reopens it. The course home says so; whether instructors are nudged to reopen is part 3's call.
