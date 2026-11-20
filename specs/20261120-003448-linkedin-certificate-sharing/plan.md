# Implementation Plan: Add a Certificate to a LinkedIn Profile

**Branch**: `20261120-003448-linkedin-certificate-sharing` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261120-003448-linkedin-certificate-sharing/spec.md`

## Summary

A learner with a certificate gets an "Add to LinkedIn profile" link in My Learning and, as its owner, on the certificate's public page. The student portal builds LinkedIn's "add certification" address from what the certificate already prints, and nothing is sent to LinkedIn from a server. Issuing a certificate now also writes a `certificate.issued` notification in the same transaction, whose email carries a second link that reaches LinkedIn in one click, signed in or not. Three days later a one-time EventBridge Scheduler schedule runs a small Lambda that sends one `certificate.reminder`, unless the link was used or certificate emails are off. The first use of the link is recorded on the certificate through one public core-api mutation. The page renderer serves `/certificates/*` with social-card tags.

What the code showed that the issue couldn't:

1. `recalculateStudent` (`packages/events/src/progress/recalculate.ts`) returns as soon as it finds a certificate. A notification published in a step after issuing would be lost if that step failed, because the retry stops at the certificate. So the notification is written in the certificate's own transaction, with `notificationWrites`, which exists for that (research R-4).
2. The delivery Lambda builds each email from the stored notification only (`send-email.ts`), which holds a title, a body and one link. The second link therefore has to be stored: an optional `action` on the notification (R-5).
3. Email preferences are per type. Two types with one setting needs a small registry field, `emailPreferenceType`, and one shared reader, `isEmailEnabled` (R-6).
4. Every public core-api operation today is a query. Recording a click from an email, signed out, makes `certificate.recordLinkedInClick` the first public mutation. The construct already takes the method from the procedure, so nothing in the infrastructure changes for it (R-3).
5. The renderer serves a fixed list of paths (`PAGE_RENDERER_PATHS`), and always passes the stage's `allowIndexing` to `buildHead`. Certificate pages need an entry in the list and a `noindex` that doesn't depend on the stage (R-8).
6. LinkedIn's own page for the link format couldn't be read, and a LinkedIn help article says prefilled values may be ignored (R-1). The link still opens the right form, the owner's page lists the values to copy, and a reviewer checks a real link before the first PR merges.

## Technical Context

**Language/Version**: TypeScript (Node 24 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC and zod (`@discava/core-api`), ElectroDB (`@discava/core-table`), `@aws-sdk/client-scheduler` (already used by `common-server-utils/cleanup-scheduler`, now also by `@discava/events`), Powertools and middy (events), TanStack Router and Query, shadcn `Button` from `@discava/common-shadcn`, `aws-cdk-lib` `aws-scheduler`. No new library.

**Storage**: the one core table. Four optional attributes on `certificate`, one optional attribute on `notification`. No new entity or index ([data-model.md](./data-model.md)).

**Testing**: vitest per project; core-table `helpers/invariants/` with breaking tests; student-portal component tests with `renderWithCoreApi`; Playwright scenarios in `packages/e2e` (`scenarios/certificate.e2e.ts`, `concurrency/certificate-issue.e2e.ts`) with `screenshot()`; `@discava/infra:synth` and construct tests.

**Target Platform**: AWS Lambda, API Gateway, DynamoDB, EventBridge Scheduler, CloudFront. Locally, `pnpm dev` with Docker and the event runner.

**Project Type**: web application: a serverless backend plus React portals.

**Performance Goals**: the notification reaches the bell with the certificate, within 30 s of the last item (SC-005). One click from each surface to LinkedIn (SC-001). A recalculation of a student who already has a certificate still costs one read.

**Constraints**:
- Nothing is sent to LinkedIn except the address the learner's browser opens, and it carries only the certificate's printed values and the issuer (FR-007, FR-008).
- Exactly one `certificate.issued` per certificate, at most one `certificate.reminder`, under retries and concurrency.
- The reminder and the click are decided by conditional writes on the certificate, never by reading then writing.
- `certificate.verify` returns the same four fields.
- Works under `pnpm dev` with no AWS account.

**Scale/Scope**: one schedule and at most two notifications per certificate. Touches core-table, core-api (router and page renderer), events (progress, notifications, a new handler, the local runner), the student portal, common-constructs, infra, infra-config, e2e, local-dev tooling and the docs.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design: still passes.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | Lambda, DynamoDB, EventBridge Scheduler (already in use), CloudFront. LinkedIn is only a link the learner opens: no integration, SDK or API |
| II. Generators first | Pass | One new Lambda construct, `EventsCertificateReminder`, made with the `ts#lambda-function` generator like every `events-*` function. Everything else extends existing projects, and a tRPC procedure, a notification type and a portal route have no generator |
| III. Everything runs locally | Pass | Scheduler's stand-in is the event runner's new `POST /schedules/certificate-reminder`, beside the cleanup one. Emails land in the local inbox. The renderer on port 2026 serves the certificate head. Only LinkedIn's own form is outside, by nature |
| IV. Layered tests | Pass, planned | Unit tests for each helper, the procedure, the handler, the schedule call, the email template, the renderer and the link builder. Three new invariants and two extended, each with a breaking test. The certificate e2e scenario and the certificate concurrency test are extended. Impact check below |
| V. Single-table via ElectroDB | Pass | No new entity or index. Every read is by a key or the existing `byCertificateId` index ([data-model.md](./data-model.md) C1 to C3). No scan in a request: uptake is read by tooling. `STREAM_FEATURES` is unchanged, with tests that the new `certificate` MODIFYs match no feature |
| VI. Secure by default | Pass | The public mutation writes one set-once flag, returns nothing, and sits behind core-api's WAF and public throttle. The scheduler role can invoke one Lambda, and the recalculation Lambda can pass only that role. The failure queue is encrypted like the others. Verification pages are `noindex` on every stage. No default is relaxed |
| VII. Change freely before launch | Pass | `issueCertificate`'s signature changes outright (it takes the whole service). Earlier certificates get no notification and no backfill is written |
| VIII. Repo conventions | Pass | core-table code in `helpers/certificate.ts` and `helpers/notification-preference.ts`. The schedule call and the handler in `packages/events/src/certificates/` (one consumer). The link builder in the student portal's `lib/`. Text-only buttons. Screenshots in e2e. English docs, with translations noted as pending |

**Impact check (constitution IV).** Shared records the feature writes, or reads in a new way:

| Record | Use | Existing invariants and tests that cover it | What changes |
|--------|-----|----------------------------------------------|--------------|
| `certificate` | Written in three new ways (click, schedule mark, reminder claim), all through `helpers/certificate.ts`. core-api becomes a second package that causes a write, through the helper | `certificate-shape`, `certificate-has-completed-enrolment` (`invariants/certificates.ts`), `certificate.test.ts`, `concurrency/certificate-issue.e2e.ts` | New: `certificate-linkedin-click-shape`, `certificate-reminder-not-after-click`, `certificate-notifications-match`. The existing two are unchanged and must still pass. `entity-writers.json` is regenerated |
| `notification`, `notificationState` | A new producer (the recalculation Lambda, inside `issueCertificate`) and a new one (the reminder Lambda), both through `notificationWrites` or `publishNotification`. `notification` gains `action` | `notification-unread-count-matches`, `notification-shape`, `notification-state-exists` (`invariants/notifications.ts`), `notification.test.ts`, `concurrency/notification.e2e.ts` | `notification-shape` is extended for `action`. The count and state rules are kept by the helper and need no change. The concurrency test for issuing asserts one notification |
| `notificationPreference` | Read through the new `isEmailEnabled`, also by the reminder Lambda. Never written for a type with `emailPreferenceType` | `notification-preference-shape`, `notification-preference.test.ts` | `notification-preference-shape` is extended: no preference for such a type |
| `enrolment`, `course`, `user` | Read as today by the recalculation | their existing checks | None |
| Stream consumers | `certificate` MODIFYs are new stream records | `progress-stream.test.ts`, `search-stream.test.ts`, `analytics-stream.test.ts`, `notification-stream.test.ts`, `stream-features.test.ts` | An assertion in each that a `certificate` MODIFY matches no filter. `notification` INSERTs from the new producers are handled by `notification-delivery` as any other |

**Weakened or changed tests (constitution IV).** Two intended changes, each named in its task and to be repeated in that PR's description:

- `issueCertificate` now takes the whole table service and runs a transaction. The fakes in `core-table/src/helpers/certificate.test.ts` and `events/src/progress/recalculate.test.ts` that pass only `entities`, or that assert a bare `certificate.create`, are updated to the transaction. Every assertion about what is issued, to whom and how often stays.
- `recalculateStudent` no longer always stops at an existing certificate: it may schedule a reminder. Tests asserting "no further call once a certificate exists" keep that assertion for certificates that have `reminderScheduledAt`, and gain a case for one that hasn't.

No assertion is loosened, and no test is skipped or deleted.

## Design Decisions (detail in [research.md](./research.md))

1. **The LinkedIn address is built in the student portal** by one pure function with a pinned parameter set (R-1, R-2). No server builds it or calls LinkedIn.
2. **The issuer is the stage's site name**, or the stage's LinkedIn organisation ID when set (R-2).
3. **The click is two set-once attributes on the certificate**, written by `recordLinkedInClick` behind one public mutation keyed by the certificate ID (R-3).
4. **The issued notification rides the certificate's transaction** (R-4).
5. **An optional `action` on a notification** gives the email its second link, which opens a public portal route that records and redirects (R-5).
6. **One email setting for both types** through `emailPreferenceType` and `isEmailEnabled` (R-6).
7. **One Scheduler schedule per certificate**, created by the recalculation and repaired on the next one, and a reminder Lambda whose claim is a conditional write (R-7).
8. **The renderer serves `/certificates/*`** with a head from `certificate.verify`, always `noindex` (R-8).
9. **Ownership on the public page comes from `certificate.myCertificates`**, so `certificate.verify` stays the same for everyone (R-9).
10. **Revocation is #594's.** Each "may this be shared?" decision is in one place for it to extend (R-10).

## Project Structure

### Documentation (this feature)

```text
specs/20261120-003448-linkedin-certificate-sharing/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R-1 to R-10, with the LinkedIn link's sources
├── data-model.md        # Phase 1: attributes, helpers, types, invariants, config
├── quickstart.md        # Phase 1: how to check it by hand
├── contracts/
│   ├── core-api-certificate.md          # certificate.recordLinkedInClick, and what stays
│   ├── student-portal-ui.md             # the link builder, the action, the owner's page, the email's route
│   ├── notifications-and-reminder.md    # registry, isEmailEnabled, email, schedule, reminder Lambda, infra
│   └── page-renderer-certificate.md     # the head crawlers get
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/databases/core-table/
├── src/entities/certificate.ts                  # + linkedInClickedAt, linkedInClickSource, reminderScheduledAt, reminderSentAt
├── src/entities/notification.ts                 # + action
├── src/helpers/certificate.ts                   # issueCertificate in a transaction; + recordLinkedInClick, certificateReminderDueAt,
│                                                #   markCertificateReminderScheduled, claimCertificateReminder
├── src/helpers/notification-types.ts            # + certificate.issued, certificate.reminder, emailPreferenceType, action
├── src/helpers/notification.ts                  # notificationWrites stores action
├── src/helpers/notification-preference.ts       # + isEmailEnabled; setNotificationPreference refuses a governed type
├── src/helpers/invariants/certificates.ts       # + three checks
├── src/helpers/invariants/notifications.ts      # notification-shape and notification-preference-shape extended
├── src/helpers/*-stream.test.ts                 # + a certificate MODIFY matches nothing
└── entity-writers.json                          # regenerated

packages/apis/core-api/src/
├── schema/certificate.ts                        # + RecordLinkedInClick input and output
├── procedures/certificate.ts                    # + recordLinkedInClick
├── procedures/notification.ts                   # preference list leaves governed types out
├── router.ts                                    # certificate.recordLinkedInClick; PUBLIC_OPERATIONS += it
└── page-renderer/
    ├── render-certificate.ts                    # new
    ├── page.ts                                  # buildHead: noindex option, optional structured data
    └── handler.ts                               # + the certificates branch

packages/events/src/
├── certificates/reminder-schedule.ts            # new: scheduleCertificateReminder
├── certificates/certificate-reminder.ts         # new: the reminder Lambda
├── progress/recalculate.ts                      # schedules after issuing, and repairs
├── notifications/email-template.ts              # + action
├── notifications/send-email.ts                  # isEmailEnabled; token and name from the governing type; passes action
└── local/event-runner-server.ts, event-runner.ts # + POST /schedules/certificate-reminder

packages/common/server-utils/src/local-dev.ts    # + LOCAL_EVENT_RUNNER.certificateReminderDelaySeconds

packages/common/constructs/src/app/
├── lambda-functions/events-certificate-reminder.ts   # generated
└── static-websites/student-portal.ts                 # PAGE_RENDERER_PATHS += '/certificates/*'

packages/common/infra-config/src/
├── stages.types.ts                              # + studentPortal.linkedInOrganizationId
└── env-overrides.ts                             # + the key as a string

packages/infra/src/stacks/
├── stream-router-stack.ts                       # reminder Lambda, schedule group, role, grants, runtime config, failure queue
└── websites-stack.ts                            # runtime config connection.site

packages/websites/student-portal/src/
├── lib/linkedin-add-to-profile.ts               # new
├── local-dev-config.ts                          # + site
├── routes/my-learning/-components/certificate-actions.tsx   # + the link
├── routes/my-learning/index.tsx                 # passes courseTitle and completedAt
├── routes/certificates/$certificateId/index.tsx # owner's section
├── routes/certificates/$certificateId/-components/owner-share.tsx   # new
└── routes/certificates/$certificateId/linkedin.tsx          # new: the email's route

packages/tooling/local-dev/src/notify-local/args.ts   # refuses certificate.* types (they belong to a certificate)

packages/e2e/src/
├── helpers/certificate.ts or student-portal.ts  # + helpers for the link, the inbox email and the reminder trigger
├── scenarios/certificate.e2e.ts                 # extended
└── concurrency/certificate-issue.e2e.ts         # + one notification

docs/src/content/docs/en/design/certificates.mdx      # + "Adding it to LinkedIn", "Telling the learner", "The link preview"
docs/src/content/docs/en/guides/notifications.mdx     # + the two types, action and emailPreferenceType
docs/src/content/docs/en/design/public-pages.mdx      # + /certificates/* in the renderer's paths
```

**Structure Decision**: Every certificate write stays in `core-table/src/helpers/certificate.ts`, so core-api, the recalculation and the reminder Lambda share one implementation of each rule (constitution IV). The schedule call and the reminder handler live in `packages/events/src/certificates/`, because only events code uses them. The link builder and all three surfaces are in the student portal, the only portal that shows certificates. The reminder's Lambda, schedule group and role go in `StreamRouterStack`, beside the recalculation Lambda that is their only caller, so no new cross-stack reference appears.

## Complexity Tracking

No violations to justify.
