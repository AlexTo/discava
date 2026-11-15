# Feature Specification: In-App and Email Notification Pipeline

**Feature Branch**: `20261115-204427-notifications`

**Created**: 2026-11-15

**Status**: Draft

**Input**: User description: "Issue #281, feat(notifications): in-app and email notification pipeline. Assignments grading, replies and announcements all need a way to reach users. Build the shared pipeline once."

**Parent issue**: #281

## Clarifications

### Session 2026-11-15

- Q: Can a user switch off in-app notifications per type, or only email? → A: Email only. The bell always receives every notification; per-type in-app muting can be added later without changing the producer contract.
- Q: If a delivery crashes after sending an email but before recording it, should a retry resend? → A: No. At-most-once: the outcome is recorded as unknown and not resent. A missed email is better than a duplicate, and the in-app notification remains.
- Q: Who does a course audience notification reach? → A: Students enrolled when it is processed. Instructors and admins are never part of the built-in audience; a producer notifies them with the single-user helper.
- Q: What makes two publishes "the same event"? → A: The same event type, recipient and producer-supplied dedupe key. The key is required, and the helper never derives one. The producer also supplies the event's occurred-at time (taken from its own record, such as the returned time), so a retry reproduces the same notification.
- Q: How does "Mark all as read" avoid hiding a notification the user has not seen? → A: It marks read up to the newest notification the user was shown (the client sends that notification's position). Anything newer stays unread, even if it arrives at the same moment. A notification published late with an occurred-at time at or before that position is created already read and is not counted.
- Q: Do notifications expire? → A: No. Nothing deletes them in this feature, so the stored unread count can't drift from an expiry; retention is a later decision.
- Q: Which portal does an emailed link open? → A: Each event type names one portal (student, instructor or admin) and a path in it; the portal's public address comes from stage configuration.

## User Scenarios & Testing *(mandatory)*

This is a foundation. Its first users are people reading notifications, but the feature is only done when other features (announcements #282, discussion replies #280, reviews #279, assignment returns from the submissions work) can publish to it with one small, stable call and no knowledge of email, preferences or delivery.

### User Story 1 - See what's new in the bell (Priority: P1)

A signed-in user (student, instructor or admin) sees a bell in the portal header with a count of unread notifications. Opening it lists their notifications, newest first, each with a title, a short body and when it happened. Selecting one takes them to the thing it is about and marks it read. They can also mark everything read.

**Why this priority**: The in-app list is the always-on channel. Email can be opted out of; the bell is where nothing is lost, and it is what every producer's notification lands in first.

**Independent Test**: Publish two notifications to a user through the producer call, sign in as that user, and check the bell shows 2, lists both newest first, opening one marks it read and drops the count to 1, and "Mark all as read" drops it to 0. Then check another user's bell is unaffected.

**Acceptance Scenarios**:

1. **Given** a user with three unread notifications, **When** they load any page, **Then** the bell shows 3 (shown as "99+" above 99).
2. **Given** the open bell, **When** they read the list, **Then** notifications are newest first, unread ones are visually distinct, and the list loads more when scrolled or asked.
3. **Given** an unread notification, **When** the user selects it, **Then** they land on the page it links to and it is marked read, and the count drops by one.
4. **Given** an already read notification, **When** the user selects it, **Then** the count does not change.
5. **Given** unread notifications, **When** the user chooses "Mark all as read", **Then** every notification they were shown is read, and the count drops by the number that were unread (to 0 if they saw them all).
6. **Given** a new notification arrives while the portal is open, **When** the count is next refreshed (within a minute, or when the window regains focus), **Then** the bell shows it without a page reload.
7. **Given** a user with no notifications, **When** they open the bell, **Then** they see an empty state, not an error.
8. **Given** two users, **When** one tries to read or mark read the other's notification, **Then** the request is refused or returns nothing.

---

### User Story 2 - Publish a notification from any feature (Priority: P1)

A developer building another feature (an announcement, a reply, a returned assignment) notifies users by calling one shared helper with an event type, the recipient, the type's parameters and a dedupe key. They do not write notification records, check preferences, send email or fan out themselves. The helper can join the producer's own database transaction, so the business change and its notification succeed or fail together, and calling it twice for the same event creates one notification.

**Why this priority**: The contract is the point of the foundation. If it is awkward or unstable, every later feature builds on sand.

**Independent Test**: In a unit test, call the helper twice with the same dedupe key and check one notification exists and the user's unread count rose by one. Call it with an unknown event type, missing parameters or no dedupe key and check it is refused before anything is written. Include the helper's writes in another transaction that fails and check no notification remains.

**Acceptance Scenarios**:

1. **Given** a registered event type and its parameters, **When** a producer calls the helper for one recipient, **Then** exactly one notification appears for that user, with the title, body and link the type's registry entry builds from the parameters.
2. **Given** a producer that retries after a timeout, **When** it calls the helper again with the same event type, recipient and dedupe key, **Then** no second notification is created and the unread count is not raised again.
3. **Given** an event type that is not registered, or parameters the type does not accept, **When** the helper is called, **Then** it fails loudly before any write, so mistakes surface in the producer's own tests.
4. **Given** the helper's writes are part of the producer's transaction, **When** that transaction is cancelled for any reason, **Then** no notification is created and the count is unchanged.
5. **Given** a producer that wants to reach every student in a course, **When** it publishes one audience notification for the course, **Then** each currently enrolled student gets one notification, without the producer reading the enrolment list or writing per-student records (see User Story 5).
6. **Given** a recipient whose user record or email is missing, **When** a notification is published, **Then** the in-app notification is still created; email is simply skipped.

---

### User Story 3 - Get an email too, exactly once (Priority: P2)

A user who has not opted out of an event type also receives an email for each notification of that type, with the same title and body, a link to the thing, and a way to stop such emails. If the delivery step retries (a crash, a timeout, the same stream record delivered twice), the user still gets at most one email per notification.

**Why this priority**: Email reaches people who are not in the portal, which is most of the value for announcements and returned work, but the in-app list works without it.

**Independent Test**: Publish a notification, run the delivery step on it twice (as a retry would), and check one email was sent and the notification records that it was sent. Run it for a user with no email address and for a type the user opted out of, and check no email is sent and the reason is recorded.

**Acceptance Scenarios**:

1. **Given** a notification of an emailable type for a user who has email on for that type, **When** delivery runs, **Then** one email is sent to the user's address with the notification's title, body and link, and the notification is marked as emailed.
2. **Given** the delivery step runs again for a notification already emailed, **When** it processes it, **Then** it sends nothing.
3. **Given** a delivery step that was cut off after sending but before recording it, **When** it retries, **Then** the user is not emailed a second time (see Assumptions: a missed email is preferred to a duplicate).
4. **Given** a transient sending failure (throttling, a temporary outage), **When** delivery runs, **Then** it is retried automatically and the email is sent once when it succeeds. A permanent failure (bad address, rejected by the provider) is recorded on the notification and not retried.
5. **Given** a user who opted out of the type, has no address, or has unsubscribed, **When** delivery runs, **Then** no email is sent; the in-app notification is unaffected.
6. **Given** a sent email, **When** the user reads it, **Then** it states why they got it, links to the notification's target, and has an unsubscribe link and the standard one-click unsubscribe header.

---

### User Story 4 - Choose what reaches my inbox (Priority: P2)

A user opens notification settings in the portal and sees each notification type with a plain-language name and description, and an email on/off switch. They turn off the types they don't want. They can also unsubscribe from a type straight from an email without signing in.

**Why this priority**: Opting out per type is an acceptance criterion and is also a legal and trust requirement for any email sent.

**Independent Test**: Turn off email for one type, publish notifications of that type and another, and check only the other emails. Follow the unsubscribe link from a captured email in a signed-out browser and check the type is now off in settings.

**Acceptance Scenarios**:

1. **Given** a user who never changed settings, **When** they open settings, **Then** every registered type shows with its default (from the registry).
2. **Given** a type switched off, **When** a notification of that type is published, **Then** it appears in the bell but no email is sent.
3. **Given** the user switches a type back on, **When** later notifications of that type arrive, **Then** they are emailed again. Notifications created while it was off are not emailed retroactively.
4. **Given** an email's unsubscribe link, **When** it is opened without signing in, **Then** the page names the type and offers one button to stop those emails (opening the link alone changes nothing, so mail scanners that follow links cannot unsubscribe anyone), then confirms, offers to turn it back on, and links to settings.
5. **Given** a tampered, truncated or wrong-user unsubscribe link, **When** it is opened, **Then** nothing changes and the page says the link is not valid.
6. **Given** the email client's one-click unsubscribe request for the same link, **When** it is received, **Then** the type is switched off without a confirmation page.
7. **Given** a type marked as required in the registry (security or account notices, if any are added), **When** the user views settings, **Then** it is shown as always on and cannot be switched off.

---

### User Story 5 - Notify a whole course at once (Priority: P2)

A producer such as an announcement feature publishes one audience notification for a course. The pipeline notifies each student enrolled at that time, however many there are, without the producer's request waiting for it, and without duplicates if the work is retried half-way.

**Why this priority**: Announcements are the first audience-wide producer (#282). Fanning out in the producer's request would be slow and not retry-safe.

**Independent Test**: Enrol three students, publish a course audience notification, run the fan-out step, and check each has exactly one notification and the unread counts are right. Run the step again and check nothing changes. Enrol a fourth student afterwards and check they are not notified retroactively.

**Acceptance Scenarios**:

1. **Given** a course with enrolled students, **When** an audience notification is published, **Then** every student enrolled at the moment it is processed gets one notification of that type.
2. **Given** a fan-out that failed half-way, **When** it retries, **Then** the students already notified are not notified again and the rest are.
3. **Given** the same audience notification published twice with the same dedupe key, **When** both are processed, **Then** each student has one notification.
4. **Given** a course with more students than one batch holds (thousands), **When** it is processed, **Then** every student is notified and processing is split across batches or invocations.
5. **Given** a student who unenrols or is not enrolled, **When** an audience notification is processed, **Then** they receive nothing.

---

### User Story 6 - See emails locally without an AWS account (Priority: P3)

A contributor running local development triggers a notification and sees the email it would send in a local inbox page, with its recipient, subject, text, links and unsubscribe link, without any AWS account or real email going out.

**Why this priority**: The constitution requires every AWS service a feature adds to have a local stand-in, and the unsubscribe and delivery flows can't be tested otherwise. It matters to contributors, not end users.

**Independent Test**: With the local stack running, publish a notification for a user and open the local inbox, check the email is listed, and follow its unsubscribe link end to end.

**Acceptance Scenarios**:

1. **Given** local development, **When** an email would be sent, **Then** it is captured and listed in the local inbox instead, newest first, and nothing leaves the machine.
2. **Given** the local inbox, **When** a contributor opens an email, **Then** they see the recipient, subject, plain-text and HTML bodies.
3. **Given** the local data is reset, **When** the inbox is opened, **Then** it is empty.

---

### Edge Cases

- A producer publishes for a user who doesn't exist yet or has signed in only once: the notification is stored by user id and shows when they sign in; email waits for a known address and is skipped, not retried forever, when there is none.
- The same event is published with the same dedupe key but different parameters: the first one wins and the second is ignored, and this is logged so a producer bug is visible.
- Two different events with the same type and recipient must have different dedupe keys; the helper doesn't guess one. A missing key is refused.
- A user marks a notification read in two tabs at once: it is marked once and the unread count drops once.
- A notification arrives at the same moment as "Mark all as read": if the user was not shown it, it stays unread, and the count and the list never disagree.
- A notification's link points at something later hidden, archived or deleted: following it shows the destination's normal not-found or no-access page; the notification itself remains.
- A user is removed or no longer allowed to see the target (unenrolled): the notification stays in their list, and the destination decides access, so notifications never leak content beyond their title and body.
- Titles and bodies built from user-supplied text (a reply's text, an announcement's title) are escaped in the portal and in HTML email, and long text is cut to a set length with an ellipsis.
- A very large unread count shows "99+".
- The email provider is in sandbox mode or the sender is not verified: delivery records a permanent failure and does not block the stream.
- Email is not configured for a stage (no sender address): in-app notifications still work and delivery records "email not configured" instead of failing.
- A delivery retry storm: the per-notification claim stops a second invocation from sending while another is mid-send.
- Preference changes while a delivery is in flight: preferences are read when delivery runs, not when the notification was created; a switch-off made before delivery wins.

## Requirements *(mandatory)*

### Functional Requirements

**Producer contract**

- **FR-001**: There MUST be one registry of notification event types. Each type has a stable id (for example `assignment.returned`), a plain-language name and description for settings, the parameters it accepts, builders for title, body and link from those parameters, whether it is emailed by default, and whether it is required (cannot be switched off).
- **FR-002**: There MUST be one helper that every producer calls to notify a single user, taking the event type, recipient, the type's parameters, a dedupe key and the time the event occurred. It MUST validate all of these before writing anything and MUST NOT silently accept an unknown type, missing parameters or a missing dedupe key.
- **FR-003**: The helper MUST be callable as a set of writes that the producer adds to its own transaction, so the business change and the notification succeed or fail together. A producer MUST NOT write notification records, unread counters or delivery state by any other route.
- **FR-004**: Publishing MUST be idempotent: the same type, recipient and dedupe key creates at most one notification and raises the unread count at most once, however many times it is called, including concurrently.
- **FR-005**: There MUST be a second helper to notify every student enrolled in a course. It records one audience notification, and delivery to each student happens afterwards, outside the producer's request, with the same idempotency per student.
- **FR-006**: The set of event types, helper signatures and parameter names are a public contract for other features: changing or removing one is a deliberate act with its tests, and adding a type is one registry entry plus its tests, without touching delivery, the API or the portals.
- **FR-007**: The registry MUST include the types the planned producers need now: announcement posted (#282), reply to a discussion post (#280), review received on a course (#279), and assignment returned. Wiring those producers is out of scope for this feature.

**In-app notifications**

- **FR-008**: Each notification MUST belong to exactly one user and hold its type, title, body, link, the time it occurred, whether it has been read, and when.
- **FR-009**: An authenticated user MUST be able to list their own notifications newest first with paging, read their unread count, mark one notification read, and mark all read. They MUST NOT be able to read or change anyone else's, and no call takes a caller-supplied user id.
- **FR-010**: The unread count MUST always equal the number of the user's unread notifications, however they were created, read, or read in bulk, with no scanning of the user's notifications to compute it.
- **FR-011**: Marking a notification read MUST be idempotent: marking an already read one changes nothing and does not lower the count again.
- **FR-012**: "Mark all as read" MUST read only notifications up to the newest one the user was shown. A notification after that position stays unread; one published later with an occurred-at time at or before that position MUST be created already read and not counted. The count and the list MUST agree afterwards.
- **FR-013**: Student, instructor and admin portals MUST each show the bell with the unread count, the list, mark read and mark all read, as one shared component, refreshing the count on a timer and when the window regains focus.
- **FR-014**: Notifications are kept until a later retention policy says otherwise; this feature does not delete them.

**Email**

- **FR-015**: After a notification is created, a separate delivery step triggered from the table's change stream MUST decide whether to email it and send at most one email for it. Delivery MUST NOT run in the producer's request and a delivery failure MUST NOT affect the notification or the producer.
- **FR-016**: Delivery MUST be idempotent on retry: it claims a notification for sending before sending and records the outcome (sent, skipped with a reason, or failed) on the notification, so a second invocation sees the claim or the outcome and sends nothing. A notification whose send outcome is unknown after a crash MUST be marked unknown and not resent.
- **FR-017**: Delivery MUST read the user's current preferences and address when it runs, and skip the email, recording why, if the user opted out, has no address, or email isn't configured for the stage.
- **FR-018**: Transient sending failures MUST be retried by the platform's normal retry for the delivery step. Permanent failures MUST be recorded and not retried. A poison notification MUST NOT block the stream for other users.
- **FR-019**: Every email MUST contain the title, body, a link to the target, a statement of why it was sent, an unsubscribe link for that type, and the standard one-click unsubscribe headers. Text and HTML versions MUST be sent, with all user-supplied text escaped.
- **FR-020**: The sender address MUST come from stage configuration. A stage without one sends no email and reports so, rather than failing.

**Preferences and unsubscribe**

- **FR-021**: Each user MUST have a per-type email preference, defaulting to the registry's default, readable and changeable only by that user through the portal's notification settings, available in all three portals.
- **FR-022**: A required type MUST always be emailed and shown as always on.
- **FR-023**: An unsubscribe link in an email MUST work without signing in, MUST only be able to switch off the one type for the one user it was made for, MUST be unforgeable and unusable for any other user or type, and MUST be safe to open repeatedly. The link's secret is stage configuration, never in the repository.
- **FR-024**: In-app notifications are not switched off by preferences in this feature (see Assumptions).

**Fan-out**

- **FR-025**: Audience delivery MUST notify the students enrolled when it is processed, in batches, with per-student idempotency so a retry after partial progress sends no duplicates and misses no one.

**Quality and local development**

- **FR-026**: Everything MUST work in local development without an AWS account: the stream-triggered steps run in the event runner, and email is captured to a local inbox instead of SES.
- **FR-027**: The writes that keep a rule other writers rely on (the unread count, idempotent creation, the read watermark) MUST live in shared core-table helpers called by every writer, each covered by an invariant check that a test can break.
- **FR-028**: Notification titles, bodies and links MUST NOT contain secrets or private data beyond what the recipient could already see in the portal, since email is not a secure channel.

### Key Entities

- **Notification**: One message for one user. Has the recipient, event type, title, body, link, occurred-at time, read state, a dedupe key, and email delivery state (pending, sending, sent, skipped with reason, failed, unknown). Ordered by occurred-at within a user.
- **Notification state**: One per user. Holds the unread count and the "read up to" watermark that mark-all-read moves.
- **Notification preference**: One per user. Holds per-type email choices, defaulting to the registry.
- **Audience notification**: A recorded request to notify every student of a course with one event, processed asynchronously and idempotently.
- **Notification event type (registry entry)**: Code, not data: id, name, description, parameter shape, title/body/link builders, default and required flags.
- **User**: Existing; supplies the email address and name.
- **Enrolment**: Existing; defines who is in a course audience.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can add a producer to a new feature by registering one event type and calling one helper, with no change to delivery, the API or the portals.
- **SC-002**: 100% of repeated publishes with one dedupe key, including concurrent ones, produce one notification and one unread increment.
- **SC-003**: 0 emails are sent twice for one notification across retries and duplicate stream deliveries.
- **SC-004**: A new notification appears in the recipient's bell within one minute of being published, and its email, when due, is sent within one minute of being published in normal operation.
- **SC-005**: 100% of notifications of an opted-out type produce no email, and an unsubscribe link switches the type off in one step without signing in.
- **SC-006**: The unread count equals the number of unread notifications after every test, checked by the data-consistency check.
- **SC-007**: A course audience notification reaches 100% of the students enrolled when it is processed, with no duplicates, for courses of at least 5,000 students.
- **SC-008**: A contributor with Docker and no AWS account can publish a notification and see its email in the local inbox in under a minute.
- **SC-009**: 0 cases where a user can read, list or change another user's notifications or preferences, or use one user's unsubscribe link for another.

## Assumptions

- Producers publish for users they already know the id of (the Cognito `sub`); resolving "who should be told" (a post's author, a course's instructors) stays in each producer, except the one built-in audience (a course's enrolled students).
- Notifications are never deleted in this feature (no retention or expiry), so the stored unread count can never drift from an expiry. A retention policy is a later decision.
- Preferences switch off email only. In-app notifications are always created, because the bell is the safe, quiet channel. Per-type in-app muting can be added later without changing the producer contract.
- The default for an emailable type is on, except where the registry says otherwise. Types that exist only to nudge (not in v1) would default off.
- At-most-once email: if a delivery crashes between sending and recording, the user may miss that email but never receives two. The in-app notification is always there.
- The notification's link is a portal path chosen by the type's builder (for example `/learn/<courseId>/lesson/<lessonId>`), resolved against the recipient's portal when emailed. A type states which portal it targets.
- Email is plain, templated by the registry's title, body and link inside one shared layout; richer templates, digests, batching and quiet hours are out of scope.
- Web push, SMS and mobile push are out of scope, and so are real-time updates (the bell polls and refreshes on focus).
- Unsubscribe is per type. A global "unsubscribe from everything" link is out of scope for v1, as users can switch every type off in settings.
- A stage without a configured, verified SES sender sends no email (`discava-development` is expected to configure one; verification and leaving the SES sandbox are manual account steps).
- Local development stands in for SES by capturing messages to a local inbox, and for stream triggers with the event runner, as the other event handlers do.
- Before launch there is nothing to migrate: the record shapes and registry can change outright.
- The issue's "core-table stream/EventBridge" fan-out is built on the core-table stream, the repository's existing pattern for table-triggered handlers (progress, search). EventBridge is not needed.
- Issue #281 is closed by the PRs implementing this spec; the producer features (#279, #280, #282) and the submissions "returned" event stay with their own issues.
