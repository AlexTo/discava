---

description: "Task list for adding a certificate to a LinkedIn profile"
---

# Tasks: Add a Certificate to a LinkedIn Profile

**Input**: Design documents from `/specs/20261120-003448-linkedin-certificate-sharing/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires tests, so they're included: unit tests for every helper, procedure and handler, invariants with breaking tests, portal component tests, and extended `packages/e2e` scenarios. Write each task's tests first and watch them fail. Never weaken an existing test to make it pass. The two intended test changes (plan, "Weakened or changed tests": T016 and T027) are named in their tasks and must be repeated in those PRs' descriptions.

**Who runs what**: An automated agent implements these tasks without `pnpm dev` or Docker. It runs unit and component tests, lint, typecheck, `build` and `synth` locally. The agent writes the e2e and concurrency tests, but PR CI runs them (`pr-checks.yml`'s `E2E tests` job). Tasks marked **(human)** need a running local stack, a LinkedIn account or people, and a reviewer does them before merging.

**Organization**: Seven phases, each one agent PR, merged in order. Each leaves `main` green and working. Phases 1 and 2 form the first PR (the first story's phase ends the first implementation issue).

| Label | Story | Priority |
|-------|-------|----------|
| US1 | Add my certificate to LinkedIn in one click | P1 |
| US2 | Be told when my certificate is issued | P1 |
| US3 | One reminder if I haven't added it | P2 |
| US4 | A shared certificate link previews well | P3 |

US3 has two phases: its rules in core-table and the notification pipeline (Phase 4), then the schedule, the Lambda and the infrastructure (Phase 5). Phase 4 sends nothing by itself.

Paths are relative to the repository root. Each PR says "Part of #592" and links `specs/20261120-003448-linkedin-certificate-sharing/`. Only the last implementation PR may close #592.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)

---

## Phase 1: Foundational - record that the LinkedIn action was used

**Goal**: The certificate can hold the first use of the action, and core-api can record it. No portal calls it yet, and nothing users see changes.

**Independent test**: `pnpm nx run @discava/core-table:test -- --run certificate invariants stream` and `pnpm nx run @discava/core-api:test -- --run certificate.test.ts router.test.ts` pass, and `pnpm nx run @discava/infra:synth` succeeds.

- [ ] T001 Tests first, then add two optional attributes to `packages/databases/core-table/src/entities/certificate.ts` ([data-model.md](./data-model.md)):
  - `linkedInClickedAt`: string (ISO);
  - `linkedInClickSource`: one of `'my-learning' | 'certificate-page' | 'issued-email' | 'reminder-email'`, exported as `LINKEDIN_CLICK_SOURCES` from `helpers/certificate.ts`.

  Change the entity's comment from "Written only by issueCertificate" to "written only by the functions in `helpers/certificate.ts`". `entities/certificate.test.ts`: both are optional, a source outside the four is refused, and the printed attributes stay read-only.
- [ ] T002 Tests first, then add `recordLinkedInClick({ coreTable, certificateId, source, now })` to `packages/databases/core-table/src/helpers/certificate.ts`, exported from `src/index.ts`:
  - `normaliseCertificateId`; a malformed ID returns `undefined` without a table read;
  - query `byCertificateId`; none returns `undefined`;
  - patch by `{ userId, courseId }`, setting `linkedInClickedAt` (`now.toISOString()`) and `linkedInClickSource`, where `linkedInClickedAt` doesn't exist; return `'recorded'`;
  - a failed condition (`isConditionalCheckFailed`) returns `'already-recorded'`; any other error is thrown.

  `helpers/certificate.test.ts`: first call records; a second call with another source returns `'already-recorded'` and the stored source and time are the first; two calls at once store one; unknown and malformed IDs return `undefined`; the printed attributes are unchanged.
- [ ] T003 Tests first, then add the invariant `certificate-linkedin-click-shape` to `packages/databases/core-table/src/helpers/invariants/certificates.ts` and to `CERTIFICATES_CHECKS`: "`linkedInClickSource` is present exactly when `linkedInClickedAt` is, is one of the four sources, and `linkedInClickedAt` isn't before `issuedAt`". `invariants/certificates.test.ts` gets a `describe('certificate-linkedin-click-shape')` starting from `consistentTable()` with one breaking case per clause. Add to `helpers/progress-stream.test.ts`, `search-stream.test.ts`, `analytics-stream.test.ts`, `notification-stream.test.ts` and `stream-features.test.ts` an assertion that a `certificate` MODIFY record matches no filter and is routed to no feature.
- [ ] T004 [P] Tests first, then add `certificate.recordLinkedInClick` exactly as in [contracts/core-api-certificate.md](./contracts/core-api-certificate.md):
  - `RecordLinkedInClickInputSchema` (`certificateId: z.string().max(64)`, `source: z.enum([...])`) and `RecordLinkedInClickOutputSchema` (`z.object({})`) in `packages/apis/core-api/src/schema/certificate.ts`, exported through `schema/index.ts`;
  - `recordLinkedInClick` in `packages/apis/core-api/src/procedures/certificate.ts`, a mutation on `publicCourseProcedure` that calls core-table's `recordLinkedInClick` with `new Date()` and maps `undefined` to the file's existing `notFound()`;
  - `recordLinkedInClick` under `certificate` in `packages/apis/core-api/src/router.ts`, and `'certificate.recordLinkedInClick'` in `PUBLIC_OPERATIONS` after `'certificate.verify'`.

  `procedures/certificate.test.ts`: an anonymous caller records a use; a second call with another source answers `{}` and the first is kept; unknown and malformed IDs get the same `NOT_FOUND` message as `certificate.verify`; a bad `source` is `BAD_REQUEST`; the output has no keys; `certificate.verify`'s output still has exactly its four keys. `router.test.ts`'s public-operations check must pass unchanged.
- [ ] T005 Run `pnpm nx run @discava/tooling-agent:entity-writers` and commit `packages/databases/core-table/entity-writers.json` if it changed. Run `pnpm nx run @discava/common-constructs:test -u` and `pnpm nx run @discava/infra:test -u` only if a snapshot changes because of the new public method, check that the only difference is `POST /certificate.recordLinkedInClick` without the Cognito authorizer and with the public throttle, and say so in the PR description.

---

## Phase 2: User Story 1 - Add my certificate to LinkedIn in one click (P1) 🎯 MVP

**Goal**: "Add to LinkedIn profile" in My Learning and, for the owner, on the certificate's page. It opens LinkedIn's form with the certificate's values and records the use.

**Independent test**: The component tests in [contracts/student-portal-ui.md](./contracts/student-portal-ui.md) pass. The e2e test "a student adds their certificate to LinkedIn" passes on PR CI, with screenshots.

- [ ] T006 [P] [US1] Tests first, then add the stage key for the LinkedIn organisation ID:
  - `linkedInOrganizationId?: string` on `StudentPortalComponentConfig` in `packages/common/infra-config/src/stages.types.ts`, with a doc comment: "The stage's LinkedIn organisation page ID (digits). When set, certificates added to LinkedIn name that page; otherwise the site name is sent as text";
  - the key as `'string'` under the student portal in `packages/common/infra-config/src/env-overrides.ts`, with a case in `env-overrides.test.ts` like `siteName`'s.
- [ ] T007 [US1] Tests first, then publish the issuer to the portals (after T006): in `packages/infra/src/stacks/websites-stack.ts`, set `runtimeConfig.set('connection', 'site', { name: config?.siteName ?? 'Discava', ...(linkedInOrganizationId && { linkedInOrganizationId }) })` from the student portal's config, and assert it in `websites-stack.test.ts` with and without the ID. Add `site: { name: 'Discava' }` to `packages/websites/student-portal/src/local-dev-config.ts`.
- [ ] T008 [P] [US1] Tests first, then add `buildLinkedInAddToProfileUrl` in `packages/websites/student-portal/src/lib/linkedin-add-to-profile.ts`, exactly the parameter table in [contracts/student-portal-ui.md](./contracts/student-portal-ui.md) (research R-1). `lib/linkedin-add-to-profile.test.ts`:
  - the whole address for one certificate;
  - a title with `&`, `#`, accents and emoji reads back unchanged from `new URL(...).searchParams`;
  - `issueMonth` has no leading zero and uses UTC (a `completedAt` of `2026-11-30T23:30:00.000Z` gives 11);
  - with `linkedInOrganizationId`, `organizationId` is sent and `organizationName` isn't;
  - the set of parameter names equals the table's, so any extra parameter fails (SC-004);
  - no parameter value contains the learner's name.
- [ ] T009 [US1] Tests first, then add the link to `packages/websites/student-portal/src/routes/my-learning/-components/certificate-actions.tsx` (after T008):
  - new props `courseTitle` and `completedAt`, passed from `certificate.myCertificates` in `routes/my-learning/index.tsx`;
  - `Button variant="outline" size="sm" asChild` around `<a href={url} target="_blank" rel="noopener noreferrer">Add to LinkedIn profile</a>`, after Copy link, text only;
  - `onClick` calls `certificate.recordLinkedInClick({ certificateId, source: 'my-learning' })` without waiting and swallows a failure.

  Extend `routes/my-learning/-my-learning.test.tsx`: the link's `href`, `target` and `rel`; a click calls the mutation with `my-learning`; a handler that throws shows no alert; a completed course without a certificate has no link. Add a `certificate.recordLinkedInClick` handler only to tests that now need it, without changing any existing assertion.
- [ ] T010 [US1] Tests first, then add the owner's section to the verification page (after T008):
  - `packages/websites/student-portal/src/routes/certificates/$certificateId/-components/owner-share.tsx`: the heading, the same link (recording `certificate-page`), the "What LinkedIn asks for" list (Name, Issuing organisation, Issue date as month and year, Credential ID, Credential URL) and the line "We can't see your LinkedIn profile, so this button stays here after you've used it.";
  - `routes/certificates/$certificateId/index.tsx` renders it only when the viewer is signed in and `certificate.myCertificates` holds a certificate with this ID. Signed out, that query isn't enabled.

  Extend `routes/certificates/$certificateId/-certificate.test.tsx`: the owner sees the section and all five values; another signed-in user doesn't; signed out doesn't, and `certificate.myCertificates` isn't in `calls`; a click records `certificate-page`; everything the page showed before is still asserted unchanged.
- [ ] T011 [US1] Extend `packages/e2e/src/scenarios/certificate.e2e.ts` with the test "a student adds their certificate to LinkedIn", reusing the file's way of completing a course:
  - route `https://www.linkedin.com/**` to a stub page (`page.context().route`), so the test never reaches LinkedIn;
  - in My Learning, expect the link's `href` to start with `https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME` and to carry the course's unique title, the certificate's ID and its verification address; take `screenshot(page, 'certificate-add-to-linkedin')`;
  - click it, expect the new tab's address to be the same, and expect a `certificate.recordLinkedInClick` response with status 200;
  - open the verification page as the owner and expect the section; take `screenshot(page, 'certificate-owner-share')`; as a second student, and signed out, expect no section.
- [ ] T012 **(human)** [US1] Before this phase's PR merges, check LinkedIn's form with a real account (research R-1): open a link built by T008 for a test certificate, note which of name, organisation, issue month and year, credential ID and credential URL arrive filled in, and whether `organizationName` and `certId` are honoured. Record the result and the date in [research.md](./research.md) R-1. If LinkedIn's names or behaviour differ, correct the table in [contracts/student-portal-ui.md](./contracts/student-portal-ui.md) and T008's test in the same PR. If a stage has a LinkedIn page, also try its `organizationId`.

---

## Phase 3: User Story 2 - Be told when my certificate is issued (P1)

**Goal**: Issuing a certificate also writes one `certificate.issued` notification. Its email has "Open" and "Add to LinkedIn profile", and the second reaches LinkedIn in one click, signed in or not.

**Independent test**: `pnpm nx run @discava/core-table:test -- --run certificate notification invariants`, `pnpm nx run @discava/events:test -- --run recalculate email-template send-email` and the student portal's `-linkedin.test.tsx` pass. The e2e test "a student is told about their certificate and adds it from the email" and the extended concurrency test pass on PR CI.

- [ ] T013 [P] [US2] Tests first, then let a notification carry a second link (research R-5, [contracts/notifications-and-reminder.md](./contracts/notifications-and-reminder.md)):
  - `build` in `NotificationType` (`packages/databases/core-table/src/helpers/notification-types.ts`) may return `action?: { label: string; path: string }`, and `buildNotification` returns it with `label` cut to 60 characters;
  - an optional `action` map (`label` string required, `path` string required, `validate: /^\//`) on `packages/databases/core-table/src/entities/notification.ts`;
  - `notificationWrites` in `helpers/notification.ts` stores `action` when built;
  - `notification-shape` in `helpers/invariants/notifications.ts` also requires that `action`, when present, has a non-empty `label` and a `path` starting with `/`.

  Tests: `notification-types.test.ts` (a type without `action` builds as before), `entities/notification.test.ts`, `notification.test.ts` (stored when built, absent otherwise), and a breaking case for the new clause in `invariants/notifications.test.ts`. core-api's `notification.list` output is unchanged: assert in `procedures/notification.test.ts` that it has no `action` key.
- [ ] T014 [US2] Tests first, then add the `certificate.issued` type to `NOTIFICATION_TYPES` (after T013), exactly the column in [data-model.md](./data-model.md): name "Certificates", the description, policy `default-on`, params `certificateId` and `courseTitle`, the title and body, `link` `/certificates/<certificateId>` in the student portal, and `action` "Add to LinkedIn profile" at `/certificates/<certificateId>/linkedin?source=issued-email`. Extend `notification-types.test.ts`, and `packages/apis/core-api/src/procedures/notification.test.ts` so the preference list includes "Certificates", on by default. `notify-local` must not publish this type by hand, because its generic sample params would name a certificate that doesn't exist and break `certificate-notifications-match` (T017): in `packages/tooling/local-dev/src/notify-local/args.ts`, refuse any type whose id starts with `certificate.` with the message "Certificate notifications belong to a certificate: complete a course instead", with a test.
- [ ] T015 [P] [US2] Tests first, then show the action in the email:
  - `NotificationEmailInput` in `packages/events/src/notifications/email-template.ts` gains `action?: { label: string; path: string }`. With one, the HTML has a second, outline-styled button linking to `portalUrl` + `path`, and the text part a line `<label>: <url>` after `Open: <url>`, both escaped;
  - `sendNotificationEmail` in `send-email.ts` passes `notification.action`.

  `email-template.test.ts`: with an action, both parts carry the label and the full address, and a label with `<` is escaped; without one, the existing expectations pass unchanged. `send-email.test.ts`: a stored action reaches the message.
- [ ] T016 [US2] Tests first, then make `issueCertificate` write the certificate and its notification together (after T014; research R-4), in `packages/databases/core-table/src/helpers/certificate.ts`:
  - `coreTable` becomes the whole service (`CoreTable`), since it needs `transaction`;
  - the write is one `transaction.write` of the certificate's `create` (item 0, conditioned on the key not existing) and `notificationWrites(service, { type: 'certificate.issued', userId, params: { certificateId: formatCertificateId(id), courseTitle }, dedupeKey: id, occurredAt: issuedAt })`;
  - cancelled with item 0 failed (`failedAt`): read and return the winner's certificate, as today;
  - cancelled for a failed condition or a conflict elsewhere: build the items again and retry, up to 3 times, then throw `VersionConflictError`;
  - the ID-collision check before the write stays.

  **Intended test change**: `helpers/certificate.test.ts` and `packages/events/src/progress/recalculate.test.ts` use fakes that pass only `entities` or expect a bare `certificate.create`. Update them to the transaction, keeping every assertion about what is issued, to whom and how often, and list the changed tests in the PR description. New cases: one notification is created with the certificate, with the stored ID as key and `issuedAt` as its time; issuing twice, and twice at once, leaves one certificate and one notification; a learner who already has other notifications gets `unreadCount` + 1; a moved `notificationState` version is retried and succeeds; certificates off, a dropped student and an incomplete enrolment write nothing. Update the call in `packages/events/src/progress/recalculate.ts` to pass the service.
- [ ] T017 [US2] Tests first, then add the invariant `certificate-notifications-match` to `packages/databases/core-table/src/helpers/invariants/certificates.ts` (after T016), for `certificate.issued` only in this phase: "every `certificate.issued` notification has a `link.path` of `/certificates/<ID>` naming a certificate of the same user, and a certificate has at most one". A certificate with no such notification isn't a violation. `invariants/certificates.test.ts`: a breaking case for an unknown ID, for another user's certificate, and for two notifications on one certificate.
- [ ] T018 [P] [US2] Tests first, then add the email's route, `packages/websites/student-portal/src/routes/certificates/$certificateId/linkedin.tsx`, exactly as in [contracts/student-portal-ui.md](./contracts/student-portal-ui.md): `certificate.verify`, then `certificate.recordLinkedInClick` with the `source` search parameter (anything but `reminder-email` is `issued-email`) waited for at most 2 seconds, then `window.location.replace` to the LinkedIn address whatever the outcome; "Opening LinkedIn…" with a "Continue to LinkedIn" link; "Certificate not found" for an unknown ID; `<meta name="referrer" content="no-referrer">` while mounted. `-linkedin.test.tsx` (the `-` prefix keeps it out of the route tree) covers the four cases in the contract's Tests section. Regenerate the route tree as the portal's other new routes do.
- [ ] T019 [US2] Extend the e2e tests (after T016 and T018):
  - in `packages/e2e/src/scenarios/certificate.e2e.ts`, add "a student is told about their certificate and adds it from the email": complete a course, expect the bell notification "Your certificate for <title> is ready" and take `screenshot(page, 'certificate-issued-notification')`; find the email with `emailsFor` (from `helpers/notification.ts`) and expect one, with the verification address and the `/linkedin?source=issued-email` address in it; in a signed-out context, with `https://www.linkedin.com/**` routed to a stub, open the email's LinkedIn address and expect to land on `https://www.linkedin.com/profile/add…` with the certificate's ID; take `screenshot(page, 'certificate-email-to-linkedin')` on the "Opening LinkedIn…" state if it can be caught, else of the stub page;
  - in `packages/e2e/src/concurrency/certificate-issue.e2e.ts`, also assert the student has exactly one `certificate.issued` notification after the race.

---

## Phase 4: User Story 3 - One reminder: the rules (P2)

**Goal**: The certificate can record that its reminder was scheduled and sent, the `certificate.reminder` type exists under the "Certificates" setting, and one function answers "may this user be emailed for this type?". Nothing schedules or sends a reminder yet.

**Independent test**: `pnpm nx run @discava/core-table:test -- --run certificate notification invariants`, `pnpm nx run @discava/core-api:test -- --run notification.test.ts` and `pnpm nx run @discava/events:test -- --run send-email` pass.

- [ ] T020 [P] [US3] Tests first, then add the reminder's attributes and helpers ([data-model.md](./data-model.md)) to `packages/databases/core-table/src/entities/certificate.ts` and `helpers/certificate.ts`, exported from `src/index.ts`:
  - optional `reminderScheduledAt` and `reminderSentAt` (ISO strings);
  - `CERTIFICATE_REMINDER_DELAY_DAYS = 3` and `certificateReminderDueAt(certificate)`: `issuedAt` plus that many days, as an ISO string;
  - `markCertificateReminderScheduled({ coreTable, userId, courseId, now })`: patch `reminderScheduledAt` where it doesn't exist; a failed condition is fine;
  - `claimCertificateReminder({ coreTable, userId, courseId, now })`: get the certificate; none returns `undefined`; a stored `reminderSentAt` returns `{ certificate, reminderSentAt }`; otherwise patch `reminderSentAt = now` where `reminderSentAt` and `linkedInClickedAt` don't exist and return it; on a failed condition read again and return the stored `reminderSentAt` if there is one, else `undefined` (a click won).

  `helpers/certificate.test.ts`: the due time; mark is set once; claim sets once and a second claim returns the first time; a claim after a click returns `undefined` and stores nothing; a click after a claim is still recorded; a claim and a click at once end in one of the two allowed states.
- [ ] T021 [P] [US3] Tests first, then add `emailPreferenceType` and `isEmailEnabled` (research R-6, [contracts/notifications-and-reminder.md](./contracts/notifications-and-reminder.md)):
  - `emailPreferenceType?: string` on `NotificationType`, and the `certificate.reminder` entry from [data-model.md](./data-model.md) with `emailPreferenceType: 'certificate.issued'`, in `packages/databases/core-table/src/helpers/notification-types.ts`. A registry test: every `emailPreferenceType` names an existing type that has none itself and the same email policy;
  - `isEmailEnabled(service, userId, type)` in `helpers/notification-preference.ts`, with the table in the contract, and `setNotificationPreference` refusing a type that has `emailPreferenceType` with `InvalidRequestError`;
  - `notification-preference-shape` in `helpers/invariants/notifications.ts` also refuses a stored preference for such a type, with a breaking test;
  - `checkRecipient` in `packages/events/src/notifications/send-email.ts` calls `isEmailEnabled` in place of its own preference read, and `sendNotificationEmail` signs the unsubscribe token for, and takes `typeName` from, the governing type;
  - the preference list in `packages/apis/core-api/src/procedures/notification.ts` leaves out types that have `emailPreferenceType`.

  Tests: `notification-preference.test.ts` (each row of the table; the reminder follows `certificate.issued` on, off and unset); `send-email.test.ts` (a reminder notification is skipped as `opted-out` when "Certificates" is off, its token verifies for `certificate.issued`, its footer says "Certificates"; every existing case passes unchanged); `procedures/notification.test.ts` (one "Certificates" row, no reminder row, and `setPreference` for `certificate.reminder` is `BAD_REQUEST`). `notify-local` already refuses `certificate.` types (T014): add `certificate.reminder` to that test.
- [ ] T022 [US3] Tests first, then the reminder's invariants in `packages/databases/core-table/src/helpers/invariants/certificates.ts` (after T020 and T021):
  - new `certificate-reminder-not-after-click`: "when both are present, `reminderSentAt` isn't after `linkedInClickedAt`; `reminderSentAt` isn't before `issuedAt`";
  - extend `certificate-notifications-match` to `certificate.reminder`: its link names a certificate of the same user, a certificate has at most one, and that certificate's `reminderSentAt` equals the notification's `occurredAt`.

  `invariants/certificates.test.ts`: a breaking case for each clause. A certificate with `reminderScheduledAt` and no `reminderSentAt` passes.

---

## Phase 5: User Story 3 - One reminder: the schedule and the Lambda (P2)

**Goal**: Three days after a certificate is issued, its owner gets one reminder unless they used the action or turned certificate emails off.

**Independent test**: `pnpm nx run @discava/events:test -- --run recalculate certificate-reminder reminder-schedule event-runner`, `pnpm nx run @discava/infra:test -- --run stream-router-stack` and `pnpm nx run @discava/infra:synth` pass. The e2e test "a student who hasn't added their certificate gets one reminder" passes on PR CI.

- [ ] T023 [US3] Run the `ts#lambda-function` generator of `@aws/nx-plugin` (use the `nx-plugin-for-aws` MCP server's `generator-guide`) for `@discava/events` with path `src/certificates/certificate-reminder.ts`, name `certificate-reminder` and `iac: cdk`, as the other entries in `packages/events/project.json` were made. It adds the handler stub, the bundle target and `EventsCertificateReminder` in `packages/common/constructs/src/app/lambda-functions/`. Don't hand-write the construct.
- [ ] T024 [US3] Tests first, then write the handler in `packages/events/src/certificates/certificate-reminder.ts` (after T023), exactly the three steps and the case table in [contracts/notifications-and-reminder.md](./contracts/notifications-and-reminder.md): a zod-checked `{ userId, courseId }` event; `isEmailEnabled(…, 'certificate.reminder')`; `claimCertificateReminder`; `publishNotification` with `dedupeKey` the stored certificate ID, `occurredAt` the claimed `reminderSentAt` and params `certificateId` (display form) and `courseTitle`. Powertools logger, tracer and metrics as in `media/transcode-cleanup.ts`, with a `RemindersSent` count metric. `certificate-reminder.test.ts` covers every row of the case table, using the notification fake the other event tests use (`notifications/fake-notification-table.ts`), plus a malformed event that is dropped without a write.
- [ ] T025 [P] [US3] Tests first, then add `scheduleCertificateReminder` in `packages/events/src/certificates/reminder-schedule.ts`, as in the contract:
  - deployed, a `CreateScheduleCommand` named `cert-reminder-<certificateId>` in the group, role and target read with `resolveAppConfigValue('certificates', 'Reminder')`, `at(<dueAt to the second>)`, flexible window off, `ActionAfterCompletion: 'DELETE'`, `Input` `{ userId, courseId }`; a `ConflictException` is success and any other error is thrown;
  - under `isLocalDev()`, `callLocalEventRunner('POST', '/schedules/certificate-reminder', { payload })`;
  - add `certificateReminderDelaySeconds: 3600` to `LOCAL_EVENT_RUNNER` in `packages/common/server-utils/src/local-dev.ts`, with a comment saying why it's long (a reminder must not land in an unrelated e2e test).

  `reminder-schedule.test.ts`, mocking the Scheduler client as `common/server-utils/src/cleanup-scheduler.test.ts` does: the command's name, time and input; a conflict is swallowed; another error is thrown; the local call. Add `@aws-sdk/client-scheduler` to `packages/events/package.json` at the version the workspace already uses.
- [ ] T026 [P] [US3] Tests first, then add `POST /schedules/certificate-reminder` to the local event runner: the route in `packages/events/src/local/event-runner-server.ts` beside `/schedules/transcode-cleanup` (same `LocalScheduleRequest` body), and in `event-runner.ts` a `scheduleCertificateReminder` that logs and runs the handler after `delaySeconds ?? LOCAL_EVENT_RUNNER.certificateReminderDelaySeconds`, with an unref'd timer. Extend `event-runner-server.test.ts` for the route, and the file's header comment listing what the runner stands in for. Update the event runner row of the table in `CONTRIBUTING.md`'s "Running Discava Locally" only if it lists schedules by name.
- [ ] T027 [US3] Tests first, then schedule from the recalculation (after T020, T024 and T025), in `packages/events/src/progress/recalculate.ts`, following the state table in the contract: after `issueCertificate` returns a certificate, or when an existing certificate has none of `reminderScheduledAt`, `reminderSentAt` and `linkedInClickedAt` and `certificateReminderDueAt` is still ahead of `now`, call `scheduleCertificateReminder` then `markCertificateReminderScheduled`. A scheduling error is thrown, so the batch is retried.

  **Intended test change**: tests in `recalculate.test.ts` and `progress-recalculation.test.ts` asserting that nothing more happens once a certificate exists keep that assertion for a certificate with `reminderScheduledAt`, and the PR description lists them. New cases: issue then schedule then mark, in that order; an existing unscheduled certificate is scheduled; one that is scheduled, reminded, clicked or past due isn't; a scheduling error fails the run after the certificate and notification are stored, and the next run schedules without issuing again; a student with a scheduled certificate still costs one certificate read and no course or user read.
- [ ] T028 [US3] Tests first, then the infrastructure in `packages/infra/src/stacks/stream-router-stack.ts` (after T023; [contracts/notifications-and-reminder.md](./contracts/notifications-and-reminder.md), Infrastructure):
  - `EventsCertificateReminder` with `grantAppConfig` and `coreTable.grantReadWriteData`;
  - a `ScheduleGroup` with `RemovalPolicy.DESTROY` and a role assumed by `scheduler.amazonaws.com`, granted invoke on that Lambda only;
  - `configureAsyncInvoke` with 2 retries, 6 hours' maximum age and an SQS failure queue `CertificateReminderFailures`, encrypted as `MediaPipelineStack`'s `failureQueue` does;
  - on the progress recalculation Lambda: `scheduleGroup.grantWriteSchedules` and `iam:PassRole` on that role with `iam:PassedToService` `scheduler.amazonaws.com`;
  - `runtimeConfig.set('certificates', 'Reminder', { lambdaArn, schedulerRoleArn, scheduleGroupName })`.

  `stream-router-stack.test.ts`: the group, the role's trust and its single invoke permission, the recalculation role's two statements scoped to that group and role, the failure queue, and the runtime config entry. Run `pnpm nx run @discava/infra:synth` and the project's `checkov` target, and fix findings without suppressing them. Update snapshots only for these resources and say so in the PR description.
- [ ] T029 [US3] Extend `packages/e2e/src/scenarios/certificate.e2e.ts` with "a student who hasn't added their certificate gets one reminder" (after T026 and T027). Add a helper `fireCertificateReminder(userId, courseId)` in `packages/e2e/src/helpers/notification.ts` that posts `{ payload, delaySeconds: 0 }` to the event runner's `/schedules/certificate-reminder`:
  - student A completes a course and the helper fires: one bell notification "Add your <title> certificate to LinkedIn" and one email with the `source=reminder-email` address; take `screenshot(page, 'certificate-reminder-notification')`; fire again and expect still one;
  - student B uses "Add to LinkedIn profile" first (LinkedIn routed to a stub), then the helper fires: no reminder notification and no email;
  - student C turns "Certificates" off in Settings, Notifications, then the helper fires: none; take `screenshot(page, 'certificate-email-setting')` of the settings page showing one "Certificates" row.

  Also add to `packages/e2e/src/concurrency/certificate-issue.e2e.ts` a test that fires the reminder and calls `certificate.recordLinkedInClick` for the same certificate at the same moment, several times over fresh certificates: each ends with either a click and no reminder, or a reminder no later than the click, and the invariant check passes (FR-023).

---

## Phase 6: User Story 4 - A shared certificate link previews well (P3)

**Goal**: A crawler that runs no scripts gets the learner, the course and the date from the verification address. The page is never indexed.

**Independent test**: `pnpm nx run @discava/core-api:test -- --run render handler page sitemap` and `pnpm nx run @discava/common-constructs:test` pass. The e2e test "a certificate's page carries a social card" passes on PR CI.

- [ ] T030 [P] [US4] Tests first, then give `buildHead` in `packages/apis/core-api/src/page-renderer/page.ts` two options: `noindex?: boolean` (emits the robots tag whatever `context.allowIndexing` is) and an optional `structuredData` (no `ld+json` script when omitted). Its tests: both options, and every existing expectation unchanged.
- [ ] T031 [US4] Tests first, then render the certificate head (after T030), exactly [contracts/page-renderer-certificate.md](./contracts/page-renderer-certificate.md):
  - `renderCertificatePage(context, certificate)` in `packages/apis/core-api/src/page-renderer/render-certificate.ts`: the title, the description with the date in English and UTC, the canonical address in display form, the default image, `noindex: true`, an empty root;
  - in `handler.ts`, a `certificates` branch: exactly one more segment calls `deps.caller.certificate.verify` and renders, `NOT_FOUND` gives `notFound()`, deeper paths get the plain `noindex` template the learning routes get, and none gives `notFound()`. A rendered certificate always carries `X-Robots-Tag: noindex`.

  `render.test.ts` and `handler.test.ts`: the head for one certificate; a name and title with `<`, `"` and `&` are escaped; an ID without dashes gets the canonical display form; unknown and malformed IDs get byte-identical 404s; `/certificates/<ID>/linkedin` gets the plain template; `noindex` on a stage with `allowIndexing: true`; the response holds no user ID, course ID or email. `helpers/sitemap.test.ts`: no entry starts with `/certificates`.
- [ ] T032 [P] [US4] Tests first, then add `'/certificates/*'` to `PAGE_RENDERER_PATHS` in `packages/common/constructs/src/app/static-websites/student-portal.ts`. Assert the new behaviour in the construct's test (or `packages/infra/src/stacks/websites-stack.test.ts`, wherever the renderer's paths are asserted today), update snapshots only for that behaviour, and say so in the PR description.
- [ ] T033 [US4] Add "a certificate's page carries a social card" to `packages/e2e/src/scenarios/certificate.e2e.ts` (after T031), fetching from the page renderer as `public-landing-page.e2e.ts` does (`PAGE_RENDERER` in `helpers/portals.ts`): `GET /certificates/<ID>` has `og:title` with the learner's name and the course's unique title, `og:description` with the certificate ID, and a `noindex` robots tag; a made-up ID answers 404 with none of them. Open the same address in the browser through the renderer and expect the page to draw the certificate as before; take `screenshot(page, 'certificate-page-through-renderer')`.

---

## Phase 7: Polish - docs and manual checks

**Goal**: The design pages describe the feature. Reviewers confirm what needs a stack, a LinkedIn account or a deployed stage.

- [ ] T034 [P] Update the English docs, and note in the PR that translations of the other locales are pending:
  - `docs/src/content/docs/en/design/certificates.mdx`: sections "Adding it to LinkedIn" (the link, what is sent and what never is, the set-once record and that it means "opened the form", research R-1 to R-3), "Telling the learner" (the notification in the certificate's transaction, the email's two links, the "Certificates" setting, the three-day reminder and its claim, R-4 to R-7) and "The link preview" (R-8). Replace "Sharing and verifying"'s list of actions with the four actions. Add a second "Spec" link to this spec. Say how uptake is read: the share of certificates with `linkedInClickedAt`, split by `linkedInClickSource` (FR-013). Under Limitations: LinkedIn sends nothing back; a use can be recorded by anyone holding the ID; no revocation yet (#594);
  - `docs/src/content/docs/en/guides/notifications.mdx`: the two types, `action` and `emailPreferenceType`;
  - `docs/src/content/docs/en/design/public-pages.mdx`: `/certificates/*` among the renderer's paths, always `noindex`.
- [ ] T035 **(human)** Run [quickstart.md](./quickstart.md) "By hand" steps 1 to 12 against `pnpm dev`, saving screenshots to `tmp/screenshots/pr-<number>/`. Confirm in the network panel that no request goes to LinkedIn before the click, and that the address opened carries only the parameters in [contracts/student-portal-ui.md](./contracts/student-portal-ui.md) (SC-004).
- [ ] T036 **(human)** After deploying to `discava-development`, run quickstart's "On a deployed stage": the schedule exists three days out, an invoked reminder arrives once by email with a working one-click unsubscribe, and LinkedIn's Post Inspector shows the card for a certificate address.
- [ ] T037 **(human)** Tell the #594 spec (completion criteria and certificate revocation) where a revoked certificate must stop being shareable (research R-10): `recordLinkedInClick`, `claimCertificateReminder`, `certificate.verify` and the certificate actions in My Learning. Whichever feature merges second adds those checks.

---

## Dependencies

- Phases merge in order: Phase 1 → Phase 2 (the portal calls `certificate.recordLinkedInClick`) → Phase 3 (the email's route reuses Phase 2's link builder) → Phase 4 (the reminder type builds on Phase 3's `action` and `certificate.issued`) → Phase 5 → Phase 6 → Phase 7. Phase 6 uses nothing from Phases 4 and 5, so it can be reordered before them if the reminder is held back. T034 is written after Phase 6.
- Within Phase 1: T001, then T002, then T003. T004 in parallel with T003. T005 last.
- Within Phase 2: T006 and T008 in parallel, T007 after T006, then T009 and T010, then T011. T012 before merge.
- Within Phase 3: T013 and T015 and T018 in parallel, T014 after T013, T016 after T014, then T017, then T019.
- Within Phase 4: T020 and T021 in parallel, then T022.
- Within Phase 5: T023 first. T024, T025 and T026 in parallel after it, then T027 and T028, then T029.
- Within Phase 6: T030 and T032 in parallel, T031 after T030, then T033.

## Parallel examples

```text
Phase 2:  T006 (stage key)  ║  T008 (link builder)
Phase 3:  T013 (notification action)  ║  T015 (email template)  ║  T018 (email's route)
Phase 4:  T020 (certificate reminder helpers)  ║  T021 (emailPreferenceType, isEmailEnabled)
Phase 5:  T024 (handler)  ║  T025 (schedule call)  ║  T026 (local runner route)
Phase 6:  T030 (buildHead options)  ║  T032 (distribution path)
```

## Implementation strategy

- **MVP**: Phases 1 and 2, one PR. Learners add a certificate to LinkedIn from My Learning and from their certificate's page, and the use is recorded. T012's check of LinkedIn's real behaviour gates this PR.
- **Then**: Phase 3 (the notification and the email's one-click link), Phase 4 and Phase 5 (the reminder, rules first, then the schedule and infrastructure), Phase 6 (the link preview). Each is one PR that leaves `main` working.
- **Finally**: Phase 7's docs, and the reviewer's manual checks before the last PR merges.
