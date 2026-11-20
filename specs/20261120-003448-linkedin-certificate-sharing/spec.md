# Feature Specification: Add a Certificate to a LinkedIn Profile

**Feature Branch**: `20261120-003448-linkedin-certificate-sharing` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "Issue #592: add to LinkedIn profile, with a certificate-issued email and one reminder. An 'Add to LinkedIn profile' action on the certificate actions in My Learning and on the verification page when the viewer is the certificate's owner, opening LinkedIn's Add to Profile form prefilled. A `certificate.issued` notification (in-app and email, with its own email preference) sent when a certificate is issued, carrying the verification link and the Add to LinkedIn link. One reminder, a few days later, to learners who have not used the share action. Record that the share action was used. Open Graph tags on the verification page so a pasted link previews well."

**Parent issue**: #592

**Design page**: [`design/certificates`](../../docs/src/content/docs/en/design/certificates.mdx) (gains "Adding it to LinkedIn" and "Telling the learner" sections)

## Clarifications

### Session 2026-11-20

Resolved without asking, using the recommended defaults (non-interactive run).

- Q: How many days after the certificate is issued is the reminder sent? → A: Three. The issue says "a few days", and three keeps the reminder inside the week the learner finished.
- Q: Do the certificate-issued email and the reminder have one email setting or two, and what does turning it off stop? → A: One setting, "Certificates", on by default. Off means no certificate email and no reminder at all, in the bell too. The bell's certificate-issued notification always arrives.
- Q: Must the email's LinkedIn link work for a learner who isn't signed in to Discava, and how is its use recorded then? → A: Yes. It records the use by the certificate ID in the link, with no sign-in, and goes straight on to LinkedIn. Only a first use can be recorded that way, so a mail scanner or someone else holding the ID can cause at most one reminder fewer.
- Q: What is sent as the issuing organisation? → A: The stage's site name. A stage may also set its LinkedIn organisation page's identifier, which LinkedIn uses to show the page and logo. Instructors aren't the issuer.
- Q: What happens for certificates issued before this ships, and for learners who are refunded after completing? → A: Earlier certificates get no certificate-issued notification, and the action works for them. A refunded learner keeps the certificate, so the action and the reminder stay.

## User Scenarios & Testing *(mandatory)*

A learner who completes a course with certificates on already gets a certificate, a public verification page (`/certificates/<ID>`), a PDF and a link to copy (certificates spec, #276). Today nothing tells them the certificate exists, and putting it on a LinkedIn profile means typing five fields by hand. In a field trial with more than 800,000 certificate earners, a shorter, reminded LinkedIn sharing flow raised new employment by 6% (#592 has the reference). This feature adds that flow: one click to LinkedIn's "Add licence or certification" form with the fields filled in, a message when the certificate is issued, and one reminder.

LinkedIn gives no answer back. The system can know that the learner opened the form, never that they saved it.

### User Story 1 - Add my certificate to LinkedIn in one click (Priority: P1)

A learner with a certificate opens My Learning. Beside View, Download PDF and Copy link there is "Add to LinkedIn profile". Choosing it opens LinkedIn's form in a new tab with the certificate's name (the course title), the issuing organisation, the issue month and year, the credential ID and the credential URL (the verification page) already filled in. The learner checks them and saves on LinkedIn. The same action is on the certificate's verification page, but only when the signed-in viewer is the certificate's owner.

**Why this priority**: This is the feature. The trial's result came from making this step short. The message and the reminder (Stories 2 and 3) only bring people to it.

**Independent Test**: As a learner with a certificate, choose "Add to LinkedIn profile" in My Learning and check that the address opened is LinkedIn's form with the five values of that certificate, and that the use of the action was recorded. Open the verification page as the owner, as another signed-in user and signed out: only the owner sees the action.

**Acceptance Scenarios**:

1. **Given** a learner with a certificate, **When** they choose "Add to LinkedIn profile" in My Learning, **Then** LinkedIn's form opens in a new tab, prefilled with the course title, the issuing organisation, the issue month and year, the certificate ID and the verification page's address.
2. **Given** the certificate's owner is signed in, **When** they open its verification page, **Then** the page offers "Add to LinkedIn profile" with the same result.
3. **Given** a signed-out visitor, or a signed-in user who isn't the owner, **When** they open the verification page, **Then** the page shows exactly what it shows today and no LinkedIn action.
4. **Given** the learner chooses the action, **When** LinkedIn's form opens, **Then** the system records that the action was used for that certificate, with the time and where it was used from. Using it again later opens the form again and changes nothing in the record.
5. **Given** recording the use fails (the network drops, the service is down), **When** the learner chooses the action, **Then** LinkedIn's form still opens.
6. **Given** a completed course that has no certificate, **Then** My Learning shows no LinkedIn action for it.
7. **Given** LinkedIn shows the form without some or all of the values, **When** the owner looks at the verification page, **Then** every value LinkedIn asks for is on the page to copy: the course title, the issuing organisation, the month and year, the certificate ID and the page's address.

---

### User Story 2 - Be told when my certificate is issued (Priority: P1)

A few seconds after a learner completes a course, the certificate is issued and they get one notification: in the bell, and by email unless they turned certificate emails off. The email says which course the certificate is for and has two links: "View certificate" (the verification page) and "Add to LinkedIn profile", which reaches LinkedIn's prefilled form in one click, signed in or not.

**Why this priority**: Today a learner finds their certificate only if they go back to My Learning. The message is how most learners reach Story 1 at the moment they care most, and the issue's acceptance criteria require it.

**Independent Test**: Complete a course as a learner. Find one new notification in the bell and one email in the local inbox. Follow the email's LinkedIn link in a signed-out browser and land on LinkedIn's form with the certificate's values. Process the completion again: no second notification or email.

**Acceptance Scenarios**:

1. **Given** a learner completes a course with certificates on, **When** the certificate is issued, **Then** they get exactly one certificate-issued notification in the bell, naming the course and opening the verification page.
2. **Given** certificate emails are on for the learner (the default), **When** the certificate is issued, **Then** one email is sent with the course title, a link to the verification page and an "Add to LinkedIn profile" link.
3. **Given** that email, **When** the learner follows its LinkedIn link, signed in or not, **Then** LinkedIn's prefilled form opens with no step in between that needs another click, and the use is recorded as coming from the email.
4. **Given** the completion is processed again (a retry, a redelivered event, two recalculations at once), **Then** there is still one certificate, one notification and at most one email.
5. **Given** the learner turned certificate emails off, **When** a certificate is issued, **Then** the bell notification arrives and no email is sent.
6. **Given** the email, **When** the learner uses its unsubscribe link, or their mail client's one-click unsubscribe, **Then** certificate emails are off from then on, and the notification settings page shows it.
7. **Given** a course with certificates off, **When** a learner completes it, **Then** no certificate-issued notification is sent.
8. **Given** issuing the certificate succeeded, **Then** the notification exists too: the two are written together, so there is never a certificate issued by this feature without its notification, or a notification without its certificate.

---

### User Story 3 - One reminder if I haven't added it (Priority: P2)

Three days after the certificate is issued, a learner who hasn't used "Add to LinkedIn profile" gets one reminder, in the bell and by email, with the same two links. A learner who used the action, or who turned certificate emails off, gets none. There is never a second reminder.

**Why this priority**: The trial's treatment included the reminder, so it's part of what the evidence supports. It's P2 because it builds on Story 2's message and adds the only delayed step.

**Independent Test**: Issue a certificate, make the reminder come due, and find one reminder notification and email. Repeat with a learner who used the action first, and with one who turned certificate emails off: neither gets a reminder. Make the reminder come due twice: still one.

**Acceptance Scenarios**:

1. **Given** a certificate issued three days ago whose owner hasn't used the LinkedIn action and has certificate emails on, **When** the reminder comes due, **Then** exactly one reminder is sent: a bell notification and an email with the verification link and the "Add to LinkedIn profile" link.
2. **Given** the owner used the LinkedIn action from anywhere (My Learning, the verification page, an email) before the reminder came due, **Then** no reminder is sent, in the bell or by email.
3. **Given** the owner turned certificate emails off before the reminder came due (in settings or by unsubscribing), **Then** no reminder is sent, in the bell or by email.
4. **Given** the reminder comes due more than once (a retry, a duplicate delivery), **Then** the learner still gets one reminder.
5. **Given** a reminder was sent, **Then** no later event sends another for that certificate, whatever the learner does.
6. **Given** the learner follows the reminder email's LinkedIn link, **Then** LinkedIn's prefilled form opens in one click and the use is recorded as coming from the reminder.
7. **Given** the learner uses the action at the same moment the reminder comes due, **Then** either the reminder is sent and the use is recorded after it, or the use is recorded and no reminder is sent. A reminder is never recorded as sent after a recorded use.

---

### User Story 4 - A shared certificate link previews well (Priority: P3)

A learner pastes their verification link into a LinkedIn post, a message or a chat. The preview card shows the learner's name, the course and the completion date instead of the site's generic title.

**Why this priority**: It improves what others see when the link is shared, but the Add to Profile flow works without it.

**Independent Test**: Fetch the verification page's address as a link-preview crawler does (no scripts run) and read the title, description and image from the HTML. Fetch an unknown ID and get a "not found" answer with no certificate details.

**Acceptance Scenarios**:

1. **Given** an issued certificate, **When** a crawler that runs no scripts fetches its verification page, **Then** the HTML carries a title naming the learner and the course, a description with the completion date, the issuing site and the certificate ID, the page's own address and an image.
2. **Given** an unknown or malformed ID, **When** a crawler fetches the page, **Then** it gets a "not found" answer with no certificate details, the same for both.
3. **Given** any stage, including one open to search engines, **Then** verification pages tell search engines not to index them, and they aren't in the site map.
4. **Given** a person opens the same address in a browser, **Then** the page works as it does today.

---

### Edge Cases

- **LinkedIn changes or ignores the prefilled values**: LinkedIn's form is LinkedIn's. If it drops a value, the learner types it, and the owner's verification page shows every value to copy (Story 1, scenario 7). Nothing in Discava fails.
- **Learner not signed in to LinkedIn**: LinkedIn asks them to sign in and then shows the form. That is LinkedIn's flow.
- **Pop-up blocked**: the action is an ordinary link the learner clicks, not a window opened by script, so pop-up blockers don't stop it.
- **A mail scanner follows the email's link**: some mail services open links before the person does. That can record a use that never happened, which only ever means one reminder fewer, never one more. Uses are recorded with where they came from, so email-sourced uses can be read apart.
- **Someone else has the certificate ID**: the ID is public once the learner shares the link. Anyone holding it could open the email's LinkedIn link form and so record a use. The record can't be unset, changed or read back through it, and the worst result is the same: one reminder fewer.
- **Certificate issued long after completion**: a learner who completed while certificates were off, and gets a certificate at a later recalculation, gets the notification and the reminder then, counted from the day it was issued.
- **Certificates issued before this feature**: they get no certificate-issued notification. The LinkedIn action works for them.
- **Learner with no email address on record, or a stage with no sender configured**: the bell notifications arrive and the emails are skipped, as for every notification type.
- **Learner refunded after completing**: the certificate stays valid (checkout spec, FR-015), so the action and the reminder stay too.
- **Course renamed or archived after issue**: the prefilled name is the title printed on the certificate, as on the verification page.
- **Very long course title**: it's sent whole. LinkedIn applies its own limit in its form.
- **Titles with accents, non-Latin script, emoji, `&` or `#`**: they arrive in LinkedIn's form unchanged.
- **The reminder comes due while the reminder service is failing**: it's retried, and a reminder that can never be sent is kept for an operator instead of being lost silently. A reminder is never sent twice because of a retry.
- **Unknown ID on the email's LinkedIn link**: the learner sees "Certificate not found", as on the verification page.
- **Revoked certificate**: revocation doesn't exist yet (#594). When it does, a revoked certificate must not be shareable. See Assumptions.

## Requirements *(mandatory)*

### Functional Requirements

**Add to LinkedIn**

- **FR-001**: My Learning MUST offer "Add to LinkedIn profile" beside the existing certificate actions, on every completed course that has a certificate and on no other.
- **FR-002**: The certificate's verification page MUST offer the same action when, and only when, the viewer is signed in as the certificate's owner. For everyone else the page MUST stay exactly as it is today, and the public lookup MUST NOT start returning anything that identifies the owner.
- **FR-003**: The action MUST open LinkedIn's "add certification" form with these values prefilled: the certification name (the course title printed on the certificate), the issuing organisation, the issue year and month (from the completion date printed on the certificate), the credential ID (the certificate ID as displayed) and the credential URL (the verification page's address). No expiry date is sent.
- **FR-004**: The issuing organisation MUST be the stage's site name. A stage MAY also set the identifier of its LinkedIn organisation page, and when it does the form MUST be opened with that identifier so LinkedIn shows the organisation's page and logo.
- **FR-005**: From My Learning and the verification page the form MUST open in a new tab, by a link the learner clicks.
- **FR-006**: The owner's view of the verification page MUST show every prefilled value (course title, issuing organisation, issue month and year, certificate ID, page address) so the learner can copy any that LinkedIn leaves empty.

**Privacy**

- **FR-007**: The system MUST send LinkedIn nothing except the address the learner's own browser opens when they choose the action, and that address MUST contain only the values in FR-003 and FR-004, all of which the learner can see before choosing. It MUST NOT contain the learner's name, email address, user ID or any other identifier. (The credential URL leads to the public verification page, which shows the learner's name, as it does for anyone the learner gives the link to.)
- **FR-008**: The system MUST NOT call LinkedIn from its servers, load LinkedIn scripts, pixels or embedded buttons in any page, or tell LinkedIn which page the learner came from.

**Recording the use**

- **FR-009**: When the action is used, the system MUST record on the certificate that it was used: the time of the first use, and where from (My Learning, the verification page, the certificate-issued email, the reminder email). Later uses MUST NOT change the record.
- **FR-010**: The record MUST mean "the learner opened LinkedIn's form", and nothing in the product or its documents may present it as "the certificate is on LinkedIn".
- **FR-011**: A failure to record MUST NOT stop LinkedIn's form from opening.
- **FR-012**: Recording a use from an email MUST work without signing in. What a caller without a sign-in can do MUST be limited to recording a first use for a certificate whose ID they hold: they can't unset or change a record, and they learn nothing about the certificate from the answer beyond what the public lookup already gives.
- **FR-013**: The share of certificates with a recorded use, and the split by where the use came from, MUST be derivable from the stored records.

**Certificate-issued notification**

- **FR-014**: When a certificate is issued, the system MUST publish exactly one certificate-issued notification to its owner, written together with the certificate so that one never exists without the other. Repeated, retried or concurrent issuing MUST leave one certificate and one notification.
- **FR-015**: The notification MUST name the course and open the verification page. Its email MUST carry the course title, a link to the verification page and an "Add to LinkedIn profile" link.
- **FR-016**: The email's "Add to LinkedIn profile" link MUST reach LinkedIn's prefilled form in one click, signed in or not, and MUST record the use on the way (FR-009, FR-012).
- **FR-017**: Certificate emails MUST have an email setting of their own on the notification settings page, on by default, and MUST carry the pipeline's unsubscribe link and one-click unsubscribe header (notifications spec, #281).
- **FR-018**: Issuing a certificate MUST NOT fail or be delayed for the learner because of the notification, beyond the retry the certificate's own issuing already has.

**Reminder**

- **FR-019**: Three days after a certificate is issued, the system MUST send its owner one reminder (a bell notification and an email with the same two links as FR-015), unless a use is recorded (FR-009) or the owner's certificate emails are off at that time.
- **FR-020**: When a use is recorded or certificate emails are off, no reminder MUST be sent at all, neither in the bell nor by email.
- **FR-021**: At most one reminder MUST ever be sent per certificate, however many times the reminder comes due or is retried, and the system MUST keep a record on the certificate that it was sent.
- **FR-022**: The reminder MUST be governed by the same email setting and the same unsubscribe as the certificate-issued email: one setting, "Certificates", covers both.
- **FR-023**: Deciding to send the reminder and recording a use MUST be safe against each other: a reminder is never recorded as sent after a recorded use (Story 3, scenario 7).
- **FR-024**: A reminder that can't be sent after retries MUST be kept where an operator can see and replay it.

**Link preview**

- **FR-025**: The verification page's HTML, as served to a client that runs no scripts, MUST carry social-card metadata: a title naming the learner and the course, a description with the completion date, the site name and the certificate ID, the page's canonical address and an image (the site's default card image).
- **FR-026**: Verification pages MUST always tell search engines not to index them, on every stage, and MUST NOT be listed in the site map.
- **FR-027**: An unknown or malformed ID MUST get the same "not found" answer with no certificate details.

**Across the feature**

- **FR-028**: Every write to a certificate (issuing with its notification, recording a use, recording the reminder) MUST go through shared helpers, with data-consistency checks, each with a test that breaks it, covering: the shape of the use record, at most one certificate-issued and one reminder notification per certificate, each such notification belonging to an existing certificate of the same learner, and no reminder sent after a recorded use.
- **FR-029**: The whole feature MUST work in local development with no AWS account: the action, the notification and its email in the local inbox, the reminder (which local development can make come due without waiting three days) and the link-preview HTML.
- **FR-030**: The feature MUST NOT add certificate revocation, a share button for other networks, a LinkedIn post composer, a generated certificate image, or an uptake dashboard (see Assumptions).

### Key Entities

- **Certificate**: existing, one per learner per course. Gains the record of the LinkedIn action's first use (when, and where from) and the record that the reminder was sent (when). Everything printed on it stays unchangeable.
- **Certificate-issued notification** and **certificate reminder notification**: two notification types of the existing pipeline, both for the student portal. One email setting, "Certificates", governs both.
- **Add to LinkedIn link**: not stored. Built from the certificate's printed values, the stage's site name and, if set, its LinkedIn organisation identifier.
- **Stage setting**: the site name (existing) and an optional LinkedIn organisation identifier (new).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A learner with a certificate reaches LinkedIn's prefilled form in one click from My Learning, from the verification page (as owner), from the certificate-issued email and from the reminder email.
- **SC-002**: In 100% of runs, however many times and however concurrently a completion is processed, a certificate has exactly one certificate-issued notification, and the data-consistency check passes after every test.
- **SC-003**: A certificate never has more than one reminder, and 0 reminders are sent to a learner with a recorded use or with certificate emails off, across every test of retries and duplicate deliveries.
- **SC-004**: The address opened on LinkedIn contains only the course title, the issuing organisation (name or identifier), the issue year and month, the certificate ID and the verification address, checked by a test that fails on any other parameter. No request to LinkedIn is made from the system's servers or by any page before the learner clicks.
- **SC-005**: The certificate-issued notification reaches the bell within 30 seconds of the last item being completed, in step with the certificate itself.
- **SC-006**: A link-preview crawler gets the learner's name, the course and the completion date from one request to the verification address, with no scripts run.
- **SC-007**: After release, the share of certificates with a recorded use, split by where the use came from, can be read from the stored records for any period.
- **SC-008**: 0 cases where a viewer who isn't the owner sees the LinkedIn action on a verification page, or where the public lookup returns anything new about the owner.

## Assumptions

- **LinkedIn's link format isn't verified against LinkedIn's own documentation.** The format used is the widely documented one ([research.md](./research.md) R-1). LinkedIn's developer page for it couldn't be read in this run, and a LinkedIn help article says prefilled values may be ignored. A reviewer tests a real link on a LinkedIn account before the first implementation PR merges (tasks.md, a **(human)** task). If LinkedIn ignores every value, the action still opens the right form and FR-006 gives the learner the values to copy.
- The reminder is sent three days after issue. The issue says "a few days", and three keeps it inside the week the learner finished.
- One email setting, "Certificates", on by default, covers the certificate-issued email and the reminder. Turning it off stops the reminder entirely, in the bell too, because the issue's acceptance criteria say none is sent once the email type is off. The bell's certificate-issued notification always arrives, as every bell notification does (notifications spec: email is the only per-type setting).
- The issuing organisation is the stage's site name ("Discava" unless the stage sets another), not the instructor. A per-instructor or per-course organisation is a follow-up.
- A use is recorded when the learner clicks, before LinkedIn answers anything. From an email it's recorded without a sign-in, by the certificate ID in the link, so that the email keeps its one-click promise. The cost (a mail scanner or a third party holding the ID can cause a recorded use) is accepted because its only effect is one reminder fewer (see Edge Cases).
- Uptake is measured from the records. A dashboard, a metric alarm or an instructor-facing figure is out of scope.
- The reminder follows the certificate, not the enrolment: a learner refunded after completing keeps the certificate and so may get the reminder.
- Certificates issued before this ships get no certificate-issued notification, and Discava hasn't launched, so no backfill is written.
- The link-preview image is the site's default card image. A generated image of the certificate is out of scope.
- **Dependency on #594 (completion criteria and certificate revocation)**: revocation is a separate spec. This feature adds three places a revoked certificate would still be offered for sharing: the LinkedIn action, the reminder, and the link preview. Whichever of the two ships second MUST make a revoked certificate not shareable: no action, no reminder, no recorded use, and a preview that says the certificate is revoked. This spec keeps each of those decisions in one place so #594 has one check to add in each.
- The existing notification pipeline (#281) and its email, settings page and unsubscribe are reused. The public verification page, PDF and copy link (#276, #339) stay as they are.
- Only the final implementation PR may close #592.
