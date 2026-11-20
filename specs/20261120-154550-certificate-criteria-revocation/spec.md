# Feature Specification: Certificate Criteria, What Was Assessed, and Revocation

**Feature Branch**: `20261120-154550-certificate-criteria-revocation` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "Issue #594: certificate completion criteria, a certificate that states what was assessed, and revocation. Per course, the instructor chooses what a certificate requires beyond completing every item (pass the quizzes and quiz assignments; for graded uploads, have the work returned with at least a set score). The course home shows what is still needed. The verification page and PDF state the criteria met: number of assessed items, pass mark, the learner's score band, and course hours. No per-question detail. A certificate can be revoked (for example when the order is refunded), and the verification page then says so. Certificates already issued keep the criteria that applied when they were issued."

**Parent issue**: #594

**Related**: #276 (certificates, which this feature changes: [archived spec](../_archive/20261115-204447-certificates/spec.md)); #284 (Stripe checkout and refunds: [spec](../20261116-013315-stripe-checkout/spec.md)); #102 part 3 (grading of uploaded work, not built yet); #592 (add a certificate to a LinkedIn profile, specified in parallel); #290 (path certificates).

**Design page**: [`design/certificates`](../../docs/src/content/docs/en/design/certificates.mdx)

## Clarifications

### Session 2026-11-20

Resolved without asking, using the recommended defaults (non-interactive run). The first answer is the one the maintainer most needs to confirm.

- Q: Is a certificate revoked automatically when its order is refunded? → A: **No, by default.** The checkout spec decided that an issued certificate survives a refund and left revoking to the maintainer, and since its 2026-11-19 amendment a student who has completed the course cannot ask for a refund themselves. So a refund after completion is now always one that an operator chose to make, for reasons that differ (goodwill, a defect in the course, a disputed payment). An administrator can revoke the certificate with the reason "Order refunded" when that is the right call. Nothing in the checkout spec or its data rules changes. The alternative (revoke automatically on every full refund) and what it would change are set out in [research.md](./research.md) R-8, so the maintainer can choose it instead.
- Q: Who can revoke a certificate? → A: An instructor of the course, for certificates of that course, and an administrator, for any certificate. Nothing revokes automatically (see above). Every revocation records who did it, when, a reason from a short list and an optional private note.
- Q: Can a revocation be undone? → A: Yes. A revoked certificate can be restored, and it then verifies again under the same ID and link. An administrator can restore any certificate. An instructor can restore one only if an instructor of the course revoked it, so an instructor cannot overturn an administrator.
- Q: What does the public verification page show for a revoked certificate? → A: That the certificate with this ID has been revoked and is no longer valid, and the date. It shows no learner name, no course, no reason and no one's identity. Someone holding the certificate can match the ID; nobody else learns anything about the person.
- Q: Does completing every item still mark the course completed when the certificate's criteria are not met? → A: Yes. "Completed" keeps today's meaning (every item done) and stays permanent. The certificate is what waits. A course can therefore be completed without a certificate for as long as the criteria are unmet, and the course home says what is missing.
- Q: What happens to learners part-way through when the instructor changes the criteria? → A: The criteria in force when a learner qualifies are the ones that apply. A learner who already holds a certificate keeps it. A learner who does not must meet the new criteria; if the change makes them qualify, their certificate is issued within seconds without them doing anything.
- Q: Which quizzes count as "assessed"? → A: Every quiz a student can see, in a lesson or as a quiz assignment, whose pass mark is above zero. A quiz with a pass mark of zero cannot be failed, so it is treated as practice: it is not counted, not scored and never blocks a certificate.
- Q: How exact is the score a certificate states? → A: A ten-point band (for example "80–89%"), from the average of the learner's best score on each assessed item when the certificate was issued. No exact score, no per-quiz scores and no per-question detail.
- Q: Does the statement of what was assessed appear on a certificate from a course that requires nothing beyond completion? → A: It says how many items were completed and that no graded assessment was required. It shows no score: a score nobody had to reach would be misleading either way.
- Q: Is the learner told when their certificate is revoked or restored? → A: Yes, by an in-app notification and an email through the existing notifications pipeline. The message names the reason category, never the private note.
- Q: What about the criterion on graded uploads? → A: It is specified here but built last, in its own phase, after #102 part 3 (grading) is merged. Everything else ships without it.

### Session 2026-11-20 (clarify pass)

Five further points found by the ambiguity scan. Resolved without asking, using the recommended defaults (non-interactive run).

- Q: May an instructor use the reason "Order refunded"? → A: No. Refunds are handled by the platform, so that reason is for administrators only. An instructor chooses from academic integrity, issued in error and other.
- Q: Is the private note ever required? → A: Yes, when the reason is "other", so every revocation can be explained later. It is optional for the other reasons and limited to 500 characters.
- Q: How does an instructor tell two learners apart in the course's certificate list? → A: By the name printed on the certificate, the certificate ID and the dates. The list shows no email address; an instructor acting on a report already has the link or the ID.
- Q: How many certificates does the instructor's list show at once, and in what order? → A: Newest first, 50 at a time, with a way to load more. A course's certificates are listed with one keyed read per page.
- Q: How long does a revoked certificate's page keep saying "revoked"? → A: For as long as the certificate exists: indefinitely. It never falls back to "not found", so an old link keeps giving a true answer.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A certificate only when the course's criteria are met (Priority: P1)

An instructor turns on "Require passing every quiz" for a course. A student who completes every item but has not passed a quiz gets no certificate yet. When they pass, the certificate is issued, once.

**Why this priority**: This is the feature's core rule and the issue's first acceptance criterion. It is what lets a certificate mean more than "pressed Mark as done on everything".

**Independent Test**: As an instructor, set the criterion on a course with a quiz that allows several attempts. As a student, complete every item, using up the quiz's attempts without passing, and check that the course shows as completed with no certificate. Raise the attempt limit, pass the quiz, and check that exactly one certificate exists within seconds. Repeat the processing and run it concurrently: still one.

**Acceptance Scenarios**:

1. **Given** a course that requires passing every quiz, **When** a student completes every item without passing one of the quizzes, **Then** the course is completed for them, and no certificate is issued.
2. **Given** that student, **When** they later pass the quiz, **Then** one certificate is issued within seconds, without any other action.
3. **Given** a student who meets the criteria, **When** their completion is processed again (a retry, a duplicate, two at once), **Then** there is still one certificate with the same ID.
4. **Given** a course with the default criteria, **When** a student completes every item, **Then** a certificate is issued exactly as today.
5. **Given** students who already hold certificates, **When** the instructor tightens the criteria, **Then** every issued certificate stays valid and unchanged.
6. **Given** a student who completed every item but failed a quiz, **When** the instructor turns the quiz criterion off, **Then** that student's certificate is issued within seconds.
7. **Given** a user who is not an instructor of the course, **When** they try to change the criteria, **Then** it is refused.
8. **Given** a quiz whose pass mark is zero, or a quiz hidden from students, **Then** it never blocks a certificate.
9. **Given** a student who has dropped the course (left it, or was refunded), **Then** no certificate is issued to them, whatever they had passed.
10. **Given** a student who completed every item but failed a quiz, **When** the instructor sets that quiz's pass mark to zero, **Then** that student's certificate is issued within seconds, without any other action.

---

### User Story 2 - See what is still needed for the certificate (Priority: P1)

A student opens the course home and sees the certificate's requirements with what is done and what is missing: which quizzes still need a pass, with a link to each.

**Why this priority**: Without it, criteria make certificates silently not arrive. A learner who has "completed" the course must be able to see why there is no certificate and what to do.

**Independent Test**: As a student in a course that requires passing every quiz, open the course home before, during and after meeting the criteria, and check the requirements shown each time against what the student has actually done.

**Acceptance Scenarios**:

1. **Given** an enrolled student in a course with certificates on, **When** they open the course home, **Then** they see each requirement (complete every item; pass every quiz, when required) with how much of it is done.
2. **Given** an unmet quiz requirement, **Then** each quiz still to pass is named and linked, and says whether it is not yet attempted, not yet passed, or out of attempts.
3. **Given** a quiz that is out of attempts and not passed, **Then** the page says the student cannot pass it without the instructor allowing more attempts.
4. **Given** every requirement is met, **Then** the page shows the certificate with its actions, or, for the few seconds before it is issued, that it is being prepared.
5. **Given** a course with certificates turned off, **Then** nothing about a certificate is shown.
6. **Given** the instructor changes the criteria, **When** the student next opens the page, **Then** it shows the new requirements.
7. **Given** a student whose certificate was revoked, **Then** the page says so in place of the requirements.

---

### User Story 3 - The certificate states what was assessed (Priority: P1)

Someone opens a certificate's verification page, or its PDF, and reads what the learner did to earn it: how many items they completed, how many assessed items they passed and at what pass mark, the band their score fell in, and how long the course is.

**Why this priority**: The issue's reason for existing: an independent instructor's certificate has no brand behind it, so it has to say what it stands for.

**Independent Test**: Issue one certificate in a course that requires passing its quizzes and one in a course that does not; open both verification pages signed out and download both PDFs; compare each statement with what the learner did and with what the course required at that time. Then change the course's criteria, pass marks and length, and check that neither certificate changed.

**Acceptance Scenarios**:

1. **Given** a certificate issued under the quiz criterion, **When** anyone opens its verification page, **Then** it states the number of items completed, the number of assessed items passed, the pass mark (or the lowest and highest, when they differ), the learner's score band and the course length in hours when the course states one.
2. **Given** a certificate issued when nothing beyond completion was required, **Then** the page states the number of items completed and that no graded assessment was required, and shows no score.
3. **Given** either certificate, **Then** its PDF states the same things as its page.
4. **Given** an issued certificate, **When** the instructor later changes the criteria, a quiz's pass mark, the curriculum or the course length, or the learner retakes a quiz, **Then** the certificate's statement does not change.
5. **Given** the page and the PDF, **Then** neither shows an exact score, a score for one quiz, the name of any quiz, or any question or answer.

---

### User Story 4 - Revoke a certificate, and restore it (Priority: P2)

An instructor finds a student's certificate in their course's list of certificates and revokes it with a reason. An administrator can do the same for any certificate, by its ID. From then on the verification page says the certificate has been revoked, the PDF cannot be downloaded, and the learner sees that it was revoked and is not offered ways to share it. Either can restore it later.

**Why this priority**: The issue's third acceptance criterion, and the first time a certificate can stop being valid. It ranks below the criteria because certificates stay trustworthy without it for the common case, and because refunds do not depend on it (see Clarifications).

**Independent Test**: Revoke an issued certificate as the course's instructor, then check, signed out, that its page says revoked and shows no name; as the learner, that the PDF is refused and no share action is offered; that a record of who revoked it and why exists. Restore it and check everything verifies as before, under the same ID.

**Acceptance Scenarios**:

1. **Given** an instructor of a course, **When** they open the course's certificates, **Then** they see each certificate issued for it with the learner's name, the date and whether it is valid or revoked.
2. **Given** a valid certificate of their course, **When** the instructor revokes it with a reason, **Then** it becomes revoked, and who did it, when, the reason and any note are recorded.
3. **Given** a revoked certificate, **When** anyone opens its verification page, **Then** the page says the certificate with this ID was revoked on a date and is no longer valid, and shows no learner name, course, reason or person.
4. **Given** a revoked certificate, **When** its learner tries to download the PDF, **Then** it is refused with a message that the certificate has been revoked.
5. **Given** a revoked certificate, **When** its learner opens My Learning or the course home, **Then** they see that it was revoked, when and the reason category, and no view, download, copy-link or share action.
6. **Given** an administrator, **When** they look up any certificate by its ID, **Then** they see it and its history and can revoke or restore it.
7. **Given** a revoked certificate, **When** someone allowed to restore it does so, **Then** it verifies again with the same ID, link and statement, and the restoration is recorded.
8. **Given** a certificate an administrator revoked, **When** an instructor tries to restore it, **Then** it is refused.
9. **Given** an instructor, **When** they try to list, revoke or restore certificates of a course they do not teach, **Then** it is refused.
10. **Given** a revoked certificate, **When** the learner's progress is processed again, **Then** no new certificate is issued and the revoked one is not changed.
11. **Given** two people revoking the same certificate at the same moment, **Then** it is revoked once and one revocation is recorded.
12. **Given** a certificate is revoked or restored, **Then** its learner is notified in-app and by email, with the reason category and without the private note.

---

### User Story 5 - Require graded work to reach a score (Priority: P3)

An instructor adds a second criterion: every graded upload must have been returned with at least a set percentage of its points. A student gets the certificate once each has been returned with enough points.

**Why this priority**: It is the strongest evidence a certificate can carry, but it cannot be built until instructors can grade (#102 part 3). Everything above ships without it.

**Independent Test**: With grading available, set "at least 60%" on a course with one graded upload; submit work as a student and check that no certificate is issued while it waits; return it with too few points and check there is still none and the course home says why; return a resubmission with enough points and check the certificate is issued and states one more assessed item.

**Acceptance Scenarios**:

1. **Given** a course that requires graded uploads returned with at least 60%, **When** a student has submitted but the work is not returned, **Then** no certificate is issued and the course home says the work is waiting to be graded.
2. **Given** the work is returned with fewer than 60% of its points, **Then** no certificate is issued, and the course home says the score needed and the score given.
3. **Given** the work is returned with at least 60% of its points and every other requirement is met, **Then** the certificate is issued within seconds of the return.
4. **Given** such a certificate, **Then** its page and PDF count the graded uploads among the assessed items, state the score required, and include those scores in the score band.
5. **Given** grading is not available yet, **Then** this criterion cannot be set and nothing about it is shown.

---

### Edge Cases

- A student passes the last quiz at the same moment the instructor tightens the criteria: the certificate is issued or not according to the criteria read when it is issued, and it records those criteria, so the data rule can still be checked afterwards.
- The instructor adds a new quiz after a student completed the course but before they qualified: the new quiz is part of what they must pass. A student who already holds a certificate is not affected.
- The instructor hides or archives the only quiz a student had not passed: the student now qualifies and gets the certificate within seconds.
- A course requires passing every quiz but has no assessed quiz: the criterion is met by everyone, and the certificate says no graded assessment was required.
- A quiz's pass mark is set to 0 (practice) after a student completed the course without passing it: the quiz is no longer assessed, so the student now qualifies and gets the certificate within seconds (FR-006). Setting it from 0 to a positive value adds the quiz to what must be passed, as adding a quiz does.
- A quiz's pass mark is raised after a student passed it: the pass stands, as it does today.
- A student is out of attempts on a quiz they did not pass: the certificate is out of reach until the instructor allows more attempts; the course home says so. Resetting one student's attempts is not part of this feature.
- A certificate issued before this feature has no statement: existing development data is fixed by hand before this ships (see Assumptions), so no page handles a missing statement.
- A course with no stated length: the statement leaves the course length out.
- A revoked certificate's link is opened with a lowercase or dash-less ID: it shows the same revoked page.
- A certificate is revoked while its course has certificates turned off, or is archived: allowed.
- A revoked certificate's learner later re-qualifies in some other way: nothing is issued. Only a restore makes it valid again.
- A PDF downloaded before the revocation still exists on someone's computer: it cannot be recalled; it prints the verification address, and that page is the truth.
- A refunded student who had completed the course keeps a valid certificate unless someone revokes it (Clarifications); their enrolment is ended either way.
- An instructor is removed from a course after revoking certificates in it: the revocations stand, and the course's remaining instructors, or an administrator, can restore them.

## Requirements *(mandatory)*

### Functional Requirements

**Criteria**

- **FR-001**: Each course MUST have certificate criteria, set by its instructors: whether every assessed quiz must be passed, and (User Story 5) whether every graded upload must be returned with at least a set percentage of its points. A new course requires neither, so the default stays as today: completing every item.
- **FR-002**: Only a course's instructors MUST be able to change its criteria, in any course status. Each change MUST be numbered, so a certificate can record which criteria it was issued under.
- **FR-003**: A certificate MUST be issued only when certificates are on for the course, the student's enrolment is completed and not ended, and the criteria in force at that moment are met. It MUST then be issued exactly once, however often or concurrently the student's progress is processed.
- **FR-004**: The quiz criterion MUST be met when the student has passed every assessed quiz: each quiz they can see, in a lesson or as a quiz assignment, whose pass mark is above zero. A pass MUST keep counting if the quiz or its pass mark changes later.
- **FR-005**: Completing every item MUST keep marking the course completed, permanently, whether or not the certificate's criteria are met. Nothing else that depends on completion (My Learning, progress, the refund period) changes.
- **FR-006**: A certificate MUST be issued within seconds of the last thing that makes the student qualify, without the student doing anything further. That includes: completing the last item, passing a quiz after the course was already completed, a change to the curriculum (including a quiz's pass mark moving to or from 0), a change to the criteria, and turning certificates on.
- **FR-007**: Changing the criteria MUST NOT remove, revoke or alter any issued certificate.
- **FR-008**: Whether the criteria are met MUST be decided by one shared rule, used both when issuing and when showing a learner what is missing, so the two cannot disagree.

**Learner view**

- **FR-009**: The course home MUST show an enrolled student, when certificates are on, each requirement with its progress and, for an unmet one, the items still needed with a link to each and its state (not attempted, not passed, out of attempts; for graded uploads: not submitted, waiting to be graded, returned below the score).
- **FR-010**: When every requirement is met the course home MUST show the certificate and its actions, or that it is being prepared; when the certificate is revoked it MUST say so instead. It MUST show nothing about a certificate when certificates are off for the course.

**What was assessed**

- **FR-011**: When a certificate is issued it MUST record, permanently: the criteria it was issued under and their number, how many items the learner completed, how many assessed items they passed, the lowest and highest pass mark among them, the learner's score band, and the course length in hours if the course states one.
- **FR-012**: The score band MUST be the ten-point range containing the average of the learner's best scores on the assessed items, as they were at the moment of issue. It MUST be recorded only when a criterion required the assessed items.
- **FR-013**: The public verification page and the PDF MUST state what the certificate recorded (FR-011), in the same words, and MUST say that no graded assessment was required when that was the case.
- **FR-014**: The verification page and the PDF MUST NOT show an exact score, the score or name of any single quiz or assignment, or any question, answer or feedback.
- **FR-015**: What a certificate states MUST NOT change when the course, its criteria, its quizzes or the learner's later results change.

**Revocation**

- **FR-016**: An instructor of a course MUST be able to list the certificates issued for it, each with the learner's name as printed, the completion date, whether it is valid or revoked, and its history of revocations and restorations. The list MUST be newest first, 50 at a time with more on request, and MUST NOT show any email address.
- **FR-017**: An instructor of a course MUST be able to revoke a valid certificate of that course, and an administrator any valid certificate, giving a reason from a fixed list (academic integrity, issued in error, other, and for administrators only: order refunded) and a private note of at most 500 characters, which is required when the reason is "other" and optional otherwise.
- **FR-018**: An administrator MUST be able to look up any certificate by its ID and see what the page prints, its status and its history.
- **FR-019**: Every revocation and restoration MUST be recorded with who did it, in which role, when, the reason and the note. The record MUST be kept for the life of the certificate and MUST never be shown publicly. The private note MUST be visible only to the course's instructors and to administrators.
- **FR-020**: A revoked certificate MUST be restorable: by an administrator always, and by an instructor of the course only when an instructor revoked it. A restored certificate MUST keep its ID, link and statement.
- **FR-021**: The public verification page for a revoked certificate MUST say that the certificate with this ID has been revoked and is no longer valid, with the date, and MUST show no learner name, course title, statement, reason or actor. It MUST remain distinguishable from "Certificate not found", and MUST keep saying so for as long as the certificate exists.
- **FR-022**: A revoked certificate's PDF MUST NOT be downloadable; the refusal MUST say the certificate has been revoked.
- **FR-023**: The learner MUST see, in My Learning and on the course home, that their certificate was revoked, when, and the reason category, and MUST NOT be offered any action that views, downloads or shares it. Every list of a learner's certificates MUST carry the status, so that other features (#592, sharing to LinkedIn) do not offer a revoked certificate.
- **FR-024**: A revoked certificate MUST NOT be replaced: processing the learner's progress again issues nothing while a certificate, valid or revoked, exists for that student and course.
- **FR-025**: Revoking and restoring MUST be safe when repeated or done by two people at once: one change of state, one record.
- **FR-026**: The learner MUST be notified when their certificate is revoked and when it is restored, in-app and by email, once per event, with the reason category and without the note.
- **FR-027**: No certificate MUST be revoked automatically. In particular a refund MUST NOT revoke one, and the checkout feature's rule that an issued certificate survives a refund stands (see Clarifications and Assumptions).

**Graded uploads (User Story 5, after #102 part 3)**

- **FR-028**: The graded-upload criterion MUST be met when every upload assignment the student can see has been returned with points that are at least the set percentage of its maximum. An assignment that is not submitted, not returned, or returned below that percentage leaves it unmet.
- **FR-029**: A change to a returned score (a regrade, or a resubmission the instructor asked for and then returned) MUST be picked up without the student doing anything, in the same seconds as other changes (FR-006).
- **FR-030**: Under this criterion the graded uploads MUST count as assessed items in the certificate's statement, their scores MUST enter the score band, and the statement MUST give the score required.
- **FR-031**: Until grading exists, the criterion MUST NOT be settable or shown.

**Data rules and delivery**

- **FR-032**: Every write of criteria, certificates and their history MUST go through shared helpers, and consistency checks that a test can break MUST cover: a certificate exists only for an enrolment that met the criteria recorded on it when it was issued; what a certificate records is complete and coherent; a certificate's valid or revoked status matches the last entry of its history; and every history entry belongs to an existing certificate.
- **FR-033**: The feature MUST work end to end in local development without a cloud account.
- **FR-034**: Each certificate and course record MUST carry the new information from the day this ships; existing development data is fixed by hand, and no page or rule treats missing information as a default.

### Key Entities

- **Certificate criteria**: Per course. Whether every assessed quiz must be passed; later, the percentage every graded upload must reach. Numbered on each change. Belongs to the course and is edited by its instructors.
- **Certificate** (existing, extended): Gains the record of what was assessed (the criteria and their number, items completed, assessed items, pass marks, score band, course hours), fixed at issue, and its status: valid, or revoked with the date and reason category.
- **Certificate history entry**: One per revocation or restoration: which certificate, what happened, when, who, in which role, the reason and the private note. Only ever added to.
- **Assessed item**: A quiz with a pass mark above zero, or (User Story 5) a graded upload, that students can see. The student's best quiz result and returned assignment score already exist; this feature reads them.
- **Enrolment** (existing): Its completed status is still required for a certificate and is not changed by this feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of runs, a student who has not met a course's criteria has no certificate, and a student who has met them has exactly one, however many times and however concurrently their progress is processed. The data-consistency check passes after every test.
- **SC-002**: A student who meets the last requirement sees the certificate within 30 seconds, whichever event made them qualify.
- **SC-003**: 0 issued certificates change, disappear or are revoked as a result of a change to criteria, quizzes, pass marks, curriculum or course length.
- **SC-004**: A student who has completed a course without its certificate can tell from one page what is missing and open the first missing item in one click.
- **SC-005**: A signed-out visitor can read what a certificate's holder was assessed on in one page load, and that page and the PDF show no exact score and no per-quiz or per-question detail.
- **SC-006**: Within 5 seconds of a revocation, the certificate's verification page says revoked, its PDF is refused, and its learner is offered no way to view, download or share it. The revoked page shows 0 facts about the learner.
- **SC-007**: 100% of revocations and restorations have a record of who, when and why, and 0 are possible for someone who is neither an instructor of the course nor an administrator.
- **SC-008**: An instructor can find and revoke a certificate of their course in under a minute.

## Assumptions

- **Completion and the certificate come apart.** "Completed" keeps meaning every item is done; it is what the refund period, My Learning and analytics already use. A quiz item still completes when it is passed or its attempts are used up. The criteria gate only the certificate.
- **The criteria in force when a learner qualifies apply to them.** There is no promise that the criteria a learner saw when they enrolled are the ones they will be held to. The instructor is told this when changing them, and the course home always shows the current ones. A learner who already qualified already has their certificate, so tightening never takes anything away.
- **Changing the criteria or turning certificates on now issues to everyone who qualifies.** This changes a decision of the certificates spec (#276), which ran no backfill when certificates were turned on and let certificates arrive "the next time progress is recalculated". With a page that tells the learner every requirement is met, a certificate that does not arrive would look broken. The cost is one pass over the course's enrolled students, as a curriculum change already costs.
- **A certificate's dates do not change.** It still prints the completion date. When the certificate was earned later than that (a quiz passed after completion), the date it was issued is recorded but not printed.
- **Course length is what the instructor states** on the course, not time measured. A course with none shows none.
- **A zero pass mark means practice.** Such a quiz is not an assessed item.
- **Refunds do not revoke.** The checkout spec's decisions stand unchanged: a refund ends the enrolment and leaves the certificate, and its data rule that a certificate's enrolment may be ended while keeping its completion date is not touched. Revoking after a refund is a person's decision, made with the reason "Order refunded". If the maintainer prefers automatic revocation, research R-8 lists what changes; it would be an amendment to both specs.
- **Revocation is for people with a reason to use it.** Instructors and administrators only; there is no way for a learner to give up or hide a certificate, and no expiry.
- **A revoked certificate still exists.** The record, its ID and its history are kept; only its public face and its PDF change. Completion, progress and the enrolment are not touched by a revocation.
- **Notifications reuse the existing pipeline** (#281) and its preferences; this feature adds two notification types and no new delivery.
- **Existing data is fixed by hand** before the first phase ships: every course gets default criteria, and every existing certificate is given a statement or deleted, in local data and on `discava-development`. Discava has not launched, so there is nothing to stay compatible with.
- **The graded-upload criterion depends on #102 part 3** for the points, the returned state and "return and reopen for another upload". If that work ships a different shape, the last phase is revised before it starts; phases 1 to 7 do not depend on it.
- **Out of scope**: revoking automatically (on refund or otherwise); expiry and renewal; re-issuing with a better score or a changed name; a learner hiding their certificate; per-learner exceptions to the criteria; resetting one student's quiz attempts; criteria on video watch time or time spent; weighting items differently in the score; named grades ("distinction"); bulk revocation; an administrator's list of all certificates; path certificates (#290); the LinkedIn action itself (#592).
- Only the final implementation PR may close #594.
