# Research: Add a Certificate to a LinkedIn Profile

## R-1: LinkedIn's "Add to profile" link (external fact, not verified with LinkedIn)

**Decision**: Build this address in the learner's browser and open it:

```text
https://www.linkedin.com/profile/add
  ?startTask=CERTIFICATION_NAME
  &name=<course title printed on the certificate>
  &organizationName=<site name>          (or &organizationId=<number> when the stage sets one)
  &issueYear=<YYYY>
  &issueMonth=<1-12>
  &certUrl=<verification page address>
  &certId=<certificate ID as displayed, XXXX-XXXX-XXXX-XXXX>
```

Every value is percent-encoded (`URLSearchParams`). `expirationYear` and `expirationMonth` are left out: a certificate doesn't expire. When the stage sets a LinkedIn organisation ID, `organizationId` is sent instead of `organizationName`, never both.

**Status of this fact: partly confirmed, not confirmed with LinkedIn.** A web search and page fetches were run on 2026-11-20:

| Source | What it says | Kind |
|--------|--------------|------|
| `https://addtoprofile.linkedin.com/` (LinkedIn's developer page for the button) | Couldn't be read: it answered 403 to the fetch | LinkedIn, unread |
| LinkedIn Help, "Create LinkedIn Add to Profile button for certification or degree providers FAQs" (`https://www.linkedin.com/help/linkedin/answer/a528030`), shown as updated "2 years ago" | The button "will no longer autofill and members must enter the relevant information directly on their profile". Providers get "a static URL". "Existing customized buttons will continue to work, but they'll now direct to the new experience … without auto-filling certificate or degree information" | LinkedIn |
| `https://certfusion.com/linkedin-add-to-profile-url-builder` (a certificate vendor's link builder, footer dated 2026) | Base `https://www.linkedin.com/profile/add`. `startTask=CERTIFICATION_NAME` and `name` required, one of `organizationName` or `organizationId` required, `issueYear` and `issueMonth` recommended, `expirationYear` and `expirationMonth` optional, `certId` optional, `certUrl` strongly recommended. Says the form opens filled in. Recommends a plain `organizationName` unless the issuer has a real LinkedIn page | Third party |
| Search results for the same format (a Ruby helper in `mumuki-laboratory`, an npm package `linkedin-certification`, several vendor help pages) | The same path and parameter names in code in use | Third party |

The two kinds of source disagree. Third parties, including ones dated 2026, document the parameters above and say the form opens prefilled. LinkedIn's own help article says customised links still open the form but values aren't autofilled. This run couldn't sign in to LinkedIn to see which is true today.

**What the design does about it**:

- The address above is used: if LinkedIn honours the values, the learner saves in one step, and if it ignores them, the link still opens the right form.
- The owner's view of the verification page lists every value with the page's address, so they can be copied by hand (spec FR-006).
- tasks.md has a **(human)** task: before the first implementation PR merges, open a generated link on a real LinkedIn account, note which fields arrive filled, and correct this section, the parameter list in [contracts/student-portal-ui.md](./contracts/student-portal-ui.md) and the builder's test if they differ.
- The parameter names live in one function (`buildLinkedInAddToProfileUrl`), so a change is one edit.

**No callback.** LinkedIn's form sends nothing back to the site that opened it: no redirect, no webhook, no parameter for one in any source above. Discava can record that the learner opened the form, and nothing after that (spec FR-010).

**Alternatives considered**:

- LinkedIn's share URL (`/sharing/share-offsite/?url=…`): makes a feed post, not a profile entry. The trial in #592 measured the profile entry. The link preview (R-8) covers a learner who pastes the link in a post anyway.
- LinkedIn's API (creating the certification for the member): needs an approved app, the member's OAuth consent and LinkedIn's review, and sends LinkedIn data from our servers, which FR-008 forbids.
- LinkedIn's embedded button script: loads LinkedIn code in our pages, which tells LinkedIn about every viewer (FR-008).

## R-2: Where the link is built, and what the issuer is

**Decision**: A pure function in the student portal, `lib/linkedin-add-to-profile.ts`, builds the address from what the portal already has: `courseTitle`, `completedAt` and `certificateId` from `certificate.myCertificates` or `certificate.verify`, the page's own origin for `certUrl`, and the issuer from the portal's runtime config (`site.name`, and `site.linkedInOrganizationId` when set). The stacks fill `site` from the student portal's existing `siteName` stage key (default "Discava") and a new optional `linkedInOrganizationId` key.

**Rationale**:

- Only the student portal shows the action (constitution VIII: code one consumer uses stays in it).
- No server builds or sees the address, so nothing server-side can leak into it (FR-007), and one test pins the whole parameter set (SC-004).
- `issueYear` and `issueMonth` come from `completedAt` in UTC, so the same certificate always gives the same link whatever the viewer's time zone.
- `rel="noopener noreferrer"` on the link stops the browser telling LinkedIn which page it came from (FR-008).

**Alternatives considered**: returning the address from `certificate.verify` (adds a server-built outbound URL to a public response and needs the site name in core-api). The instructor as the issuer (LinkedIn's organisation field means the awarding body, and an instructor name there reads oddly; a per-instructor organisation is a follow-up).

## R-3: Recording the click

**Decision**: Two optional attributes on `certificate`, `linkedInClickedAt` and `linkedInClickSource`, set once by a new core-table helper `recordLinkedInClick`, called by one public core-api mutation, `certificate.recordLinkedInClick({ certificateId, source })`. The helper finds the certificate by ID (the existing `byCertificateId` index), then patches it with the condition that `linkedInClickedAt` doesn't exist. A second click fails the condition and is reported as already recorded.

**Rationale**:

- The email's link must work signed out (FR-016), so the caller can't be identified by a session. The certificate ID is the only thing the link carries.
- One procedure for all four sources keeps one code path and one test.
- The write is tiny and one-way: set once, never unset, and the response says nothing about the certificate. Someone who holds the ID (it becomes public when the learner shares the link) can cause one recorded use, whose only effect is one reminder fewer.
- It is core-api's first public mutation. `PUBLIC_OPERATIONS` and the `CoreApi` construct already take the method from the procedure, so API Gateway serves it without the authorizer and under the shared public throttle, with no construct change. `router.test.ts`'s check covers it.
- The attributes sit on the certificate, the record the reminder reads anyway, so the reminder's "has it been used?" costs no extra read.

**Alternatives considered**:

- A signed token in the email link (as unsubscribe links have): unforgeable, but core-api would need the signing secret and a grant, or a new route and Lambda beside the unsubscribe one. Too much for a flag whose worst misuse is one reminder fewer. It's the upgrade path if recorded uses turn out to be noisy.
- A protected mutation only: the email link would need a sign-in, breaking "one click from the email".
- A server redirect (`GET` that records and answers 302): mail scanners that prefetch links would record a use for nearly every email. The portal route records with a script-made `POST`, which fewer scanners trigger.
- A separate `certificateShare` entity with one row per click: more writes and an entity for a figure nobody asked for. First use and its source answer the issue's two needs (stop the reminder, measure uptake).

## R-4: The certificate-issued notification is written with the certificate

**Decision**: `issueCertificate` writes the certificate and its `certificate.issued` notification in one transaction: the certificate `create` (conditioned on the key not existing, as today) plus the items `notificationWrites` returns (the notification's create and the learner's `notificationState` create or update). `dedupeKey` is the certificate ID and `occurredAt` is `issuedAt`.

What the code showed:

- `recalculateStudent` (`packages/events/src/progress/recalculate.ts`) returns early when the student already has a certificate. If the notification were published in a second step and that step failed, the retry would see the certificate and never publish. Writing both together removes that gap (FR-014).
- `notificationWrites` exists for exactly this: it returns transaction items "for the producer's own `service.transaction.write`".
- A cancelled transaction has two causes. The certificate's condition failed (another run won): read and return the winner's, as today. The `notificationState` version moved (another notification for the same learner at that moment): read again and retry, up to 3 times, as `publishNotification` does.
- The notification's INSERT reaches the `notification-delivery` stream feature like any other, which sends the email. The recalculation Lambda already has read and write access to the table and needs no new permission for this.

**Rationale**: exactly one notification per certificate without a repair path, and no certificate without its notification.

**Alternatives considered**: publishing from a new stream feature on `certificate` INSERT (a queue, a handler and a failure queue for one write that a transaction already makes safe). Publishing after `issueCertificate` returns (the gap above).

## R-5: A second link in the email

**Decision**: A notification may carry one optional `action`: `{ label, path }`, in the same portal as its `link`. A type's `build` returns it, `notificationWrites` stores it on the notification, and `renderNotificationEmail` shows it as a second button and a second line in the text part. The bell ignores it.

For both certificate types: `link` is `/certificates/<ID>` and `action` is `{ label: 'Add to LinkedIn profile', path: '/certificates/<ID>/linkedin?source=issued-email' }` (`reminder-email` for the reminder).

**Rationale**: the delivery Lambda builds the email from the stored notification alone (`send-email.ts`), so what the email shows has to be stored. An explicit, optional field keeps every existing type unchanged.

**The route behind it**: `/certificates/$certificateId/linkedin` in the student portal, public. It reads the certificate with `certificate.verify`, calls `certificate.recordLinkedInClick`, and replaces the page with the LinkedIn address, whether or not recording worked (FR-011). It always shows a plain "Continue to LinkedIn" link too, for a browser that blocks the redirect. An unknown ID shows "Certificate not found".

**Alternatives considered**: making the LinkedIn route the email's only link (the learner couldn't reach the certificate itself). Deriving the action from the stored `link` with a per-type function (nothing to store, but the email would depend on code that can change after the notification was written).

## R-6: One email setting for two types

**Decision**: `NotificationType` gains an optional `emailPreferenceType`. `certificate.reminder` sets it to `certificate.issued`, which means: this type has no setting of its own, and the named type's setting, unsubscribe token and settings label govern its email. A new core-table function, `isEmailEnabled(service, userId, type)`, resolves it and is the one place that reads a preference: the delivery Lambda's `checkRecipient` calls it, and so does the reminder handler.

Changes that follow:

- `send-email.ts` signs the unsubscribe token with, and takes the footer's name from, the governing type.
- `setNotificationPreference` refuses a type that has `emailPreferenceType`, so no preference is ever stored for it. The `notification-preference-shape` invariant is extended to say so.
- core-api's preference list leaves such types out, so the settings page shows one row, "Certificates".

**Rationale**: the issue requires that no reminder is sent once "the email type is switched off". With two independent settings, unsubscribing from the first email wouldn't stop the reminder.

**Alternatives considered**: one type with a `reminder` param (no pipeline change, but the two messages couldn't be told apart by type in tests, invariants or logs). Two settings (breaks the acceptance criterion).

## R-7: The reminder

**Decision**: A one-time EventBridge Scheduler schedule per certificate, as transcode cleanup uses, targeting a new Lambda, `certificate-reminder`.

- **Scheduling**: after `issueCertificate`, `recalculateStudent` creates the schedule for `issuedAt` + 3 days with a name derived from the certificate ID (`cert-reminder-<ID>`), then marks the certificate (`reminderScheduledAt`). An existing schedule of that name (`ConflictException`) counts as done. On a later recalculation, a certificate with no `reminderScheduledAt`, no recorded click, no reminder sent and a due time still ahead gets the same step, so a crash between issuing and scheduling is repaired. A failure throws, and the batch is retried, as a failed issue is today. The learner's progress is already written by then.
- **Sending**: the handler gets `{ userId, courseId }`. It stops if `isEmailEnabled` is false. It then claims the reminder: no certificate, or a recorded click, means stop; otherwise a conditional patch sets `reminderSentAt` to now, only if `reminderSentAt` and `linkedInClickedAt` don't exist (a claim made by an earlier run is read back instead). Then it publishes `certificate.reminder` with `dedupeKey` the certificate ID and `occurredAt` the stored `reminderSentAt`.
- **Exactly once**: a retry after the claim reads `reminderSentAt` back and publishes with the same `occurredAt`, so the notification's key is the same and the publish is a duplicate. The claim's condition and `recordLinkedInClick`'s condition make "send" and "click" safe against each other (FR-023): whichever write lands first decides, and the invariant `certificate-reminder-not-after-click` checks it.
- **Failure**: the Lambda is invoked asynchronously with 2 retries and a failure queue, like `transcode-cleanup` (FR-024).
- **Infrastructure**: `EventsCertificateReminder` (made with the `ts#lambda-function` generator, as every `events-*` construct is), a `ScheduleGroup`, and a role Scheduler assumes, all in `StreamRouterStack` beside the recalculation Lambda that creates the schedules. The recalculation Lambda gets `grantWriteSchedules` on that group and `iam:PassRole` on that role only. The three values the scheduler call needs go in runtime config, as `TranscodeCleanup`'s do.
- **Locally**: the event runner gains `POST /schedules/certificate-reminder`, taking the same `LocalScheduleRequest` as the cleanup route. The default local delay is one hour (`LOCAL_EVENT_RUNNER.certificateReminderDelaySeconds`), so a reminder never lands in the middle of an unrelated e2e test. The e2e test and the quickstart post to that route with `delaySeconds: 0` to make one come due.

**Rationale**: the pattern, its local stand-in and its IAM shape already exist. Nothing polls or scans. The delay is a constant in core-table (`CERTIFICATE_REMINDER_DELAY_DAYS = 3`), not stage config.

**Alternatives considered**:

- A daily job that looks for certificates due a reminder: needs a scan or a new index.
- A TTL record whose deletion triggers the reminder: DynamoDB deletes expired items within days, not at a time, and DynamoDB local doesn't do it the same way.
- A stream feature on `certificate` INSERT that creates the schedule: retried by a queue of its own, but a queue, failure queue, alarm and handler for one API call the recalculation can make and repair itself.
- Cancelling the schedule when a click is recorded: core-api would need Scheduler permissions. The handler's check costs one read on a schedule that deletes itself.

## R-8: Link preview

**Decision**: The page renderer (core-api's second handler) answers `/certificates/*` too. For `/certificates/<ID>` it calls `certificate.verify` through its anonymous caller and injects a head built by `buildHead` into the portal's template: title "`<learner>` completed `<course>`", description "Certificate of completion, `<date>`. Issued by `<site name>`. Certificate ID `<ID>`.", canonical address, the default card image. The root stays empty and the portal draws the page as today. Any deeper path (`/certificates/<ID>/linkedin`) gets the plain template. An unknown ID gets the renderer's shared 404.

- Always `noindex`, in the head and as `X-Robots-Tag`, on every stage: the page names a person. `buildHead` gains a `noindex` option that overrides the stage's `allowIndexing`. The site map already lists only courses and profiles.
- `PAGE_RENDERER_PATHS` in the `StudentPortal` construct gains `/certificates/*`. Locally the renderer on port 2026 serves it.
- Responses are cached for 5 minutes like other pages. A certificate's printed values never change, so the cache is only a concern for revocation (#594).

**Rationale**: link-preview crawlers run no scripts, and the renderer is how this repository already gives them HTML. `certificate.verify` is the same four-field projection the page uses, so the preview can't show more than the page.

**Alternatives considered**: a generated image of the certificate (a rendering pipeline for a P3 story). Pre-rendering in the static site (certificates are data, not build output).

## R-9: Who the owner is, on the public page

**Decision**: The verification page keeps calling `certificate.verify`, unchanged. When the viewer is signed in, it also calls `certificate.myCertificates` and shows the owner's section when one of their certificates has this ID.

**Rationale**: `certificate.verify` must not say who owns a certificate (FR-002, certificates spec FR-006). The owner check uses a procedure that already answers only for the caller.

**Alternatives considered**: an `isOwner` flag on `certificate.verify` (the response would depend on the caller, which defeats the renderer's cache and the "nothing else about the learner" rule).

## R-10: Revocation (#594)

Not in scope. The design keeps each "may this be shared?" decision in one place so #594 adds one check in each: `recordLinkedInClick` (refuse), the reminder handler's claim (skip), `certificate.verify` (which the page, the email route and the renderer all read) and the certificate actions in My Learning. tasks.md has a **(human)** task to tell #594's spec about them.
