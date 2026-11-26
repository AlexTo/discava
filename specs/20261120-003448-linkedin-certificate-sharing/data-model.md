# Data Model: Add a Certificate to a LinkedIn Profile

No new entity and no new index. Two existing entities gain optional attributes, and the notification registry gains two types.

## `certificate` (existing, `packages/databases/core-table/src/entities/certificate.ts`)

New optional attributes. Everything printed on the certificate stays read-only.

| Attribute | Type | Set by | Notes |
|-----------|------|--------|-------|
| `linkedInClickedAt` | string (ISO), optional | `recordLinkedInClick` | The first time "Add to LinkedIn profile" was used. Set once, never changed or removed |
| `linkedInClickSource` | `'my-learning' \| 'certificate-page' \| 'issued-email' \| 'reminder-email'`, optional | `recordLinkedInClick` | Where that first use came from. Present exactly when `linkedInClickedAt` is |
| `reminderScheduledAt` | string (ISO), optional | `markCertificateReminderScheduled` | The reminder's schedule exists. Stops the recalculation creating it again |
| `reminderSentAt` | string (ISO), optional | `claimCertificateReminder` | The reminder was claimed for sending. Set once, and only while `linkedInClickedAt` is absent. It is also the reminder notification's `occurredAt` |

The entity's comment "Written only by issueCertificate" becomes "written only by the functions in `helpers/certificate.ts`".

### Access patterns (constitution V)

| # | Pattern | Key | Used by |
|---|---------|-----|---------|
| C1 | One student's certificate for a course | primary: pk `userId`, sk `courseId` (existing) | issuing, the reminder handler, the reminder claim, marking the schedule |
| C2 | A certificate by its ID | `byCertificateId` on `gsi1pk-gsi1sk-index` (existing) | `certificate.verify`, `recordLinkedInClick` (then a patch by C1's key) |
| C3 | One student's certificates | primary pk (existing) | `certificate.myCertificates`, which the verification page now also calls to find the owner |

No scan in any request. Uptake (SC-007) is read by tooling outside a user request: the invariant snapshot, or a script over the table, counts certificates with `linkedInClickedAt` by `linkedInClickSource`.

### Helpers (`packages/databases/core-table/src/helpers/certificate.ts`, the only writers)

| Function | Does | Returns |
|----------|------|---------|
| `issueCertificate({ coreTable, enrolment, course, user, now })` | As today, but the certificate's create and its `certificate.issued` notification (`notificationWrites`) go in one transaction (research R-4). `coreTable` is now the whole service, since it needs `transaction` | The certificate, the existing one, or `undefined` when none is due |
| `recordLinkedInClick({ coreTable, certificateId, source, now })` | Normalises the ID, finds the certificate (C2), patches `linkedInClickedAt` and `linkedInClickSource` where `linkedInClickedAt` doesn't exist | `'recorded'`, `'already-recorded'`, or `undefined` for a malformed or unknown ID |
| `certificateReminderDueAt(certificate)` | `issuedAt` + `CERTIFICATE_REMINDER_DELAY_DAYS` (3) | ISO string |
| `markCertificateReminderScheduled({ coreTable, userId, courseId, now })` | Patches `reminderScheduledAt` where it doesn't exist. A failed condition is fine | nothing |
| `claimCertificateReminder({ coreTable, userId, courseId, now })` | Reads the certificate (C1). Returns the stored `reminderSentAt` if there is one. Otherwise patches `reminderSentAt = now` where `reminderSentAt` and `linkedInClickedAt` don't exist | `{ certificate, reminderSentAt }` when the reminder is to be published, `undefined` when there is no certificate or a click is recorded |

### State

```text
issued ──(click recorded)──────────────▶ clicked            (no reminder ever)
   │
   └──(reminder claimed, no click)─────▶ reminded ──(click)─▶ reminded + clicked
```

`reminderSentAt` and `linkedInClickedAt` can both be present only with `reminderSentAt` earlier or equal.

## `notification` (existing, `entities/notification.ts`)

| Attribute | Type | Notes |
|-----------|------|-------|
| `action` | map `{ label: string, path: string }`, optional | A second link for the email, in the same portal as `link`. `path` starts with `/`. Written by `notificationWrites` when the type's `build` returns one. Not returned to the bell |

## Notification types (`helpers/notification-types.ts`)

`NotificationType` gains `emailPreferenceType?: string`, and `build` may return `action`.

| | `certificate.issued` | `certificate.reminder` |
|--|----------------------|------------------------|
| Portal | student | student |
| Name (settings) | Certificates | (none shown: governed by `certificate.issued`) |
| Description (settings) | "You earn a certificate, and one reminder to add it to your LinkedIn profile." | |
| Email policy | `default-on` | `default-on`, with `emailPreferenceType: 'certificate.issued'` |
| Params | `certificateId` (display form), `courseTitle` | the same |
| Title | `Your certificate for <courseTitle> is ready` | `Add your <courseTitle> certificate to LinkedIn` |
| Body | "You completed <courseTitle>. View your certificate, or add it to your LinkedIn profile so employers can see it." | "Your certificate for <courseTitle> isn't on your LinkedIn profile yet, as far as we can tell. Adding it takes one click." |
| `link` | `/certificates/<certificateId>` | the same |
| `action` | "Add to LinkedIn profile", `/certificates/<certificateId>/linkedin?source=issued-email` | the same with `source=reminder-email` |
| Published by | `issueCertificate`, in the certificate's transaction | the `certificate-reminder` Lambda, after the claim |
| `dedupeKey` | the stored certificate ID | the stored certificate ID |
| `occurredAt` | the certificate's `issuedAt` | the certificate's `reminderSentAt` |

Rules for `emailPreferenceType` (research R-6): the named type exists, has no `emailPreferenceType` itself, and has the same email policy. `isEmailEnabled(service, userId, type)` in `helpers/notification-preference.ts` resolves it. `setNotificationPreference` refuses a type that has it.

## Invariants (`helpers/invariants/`)

New, in `certificates.ts`, each with a breaking test:

| Name | Rule |
|------|------|
| `certificate-linkedin-click-shape` | `linkedInClickSource` is present exactly when `linkedInClickedAt` is, is one of the four sources, and `linkedInClickedAt` isn't before `issuedAt` |
| `certificate-reminder-not-after-click` | When both are present, `reminderSentAt` isn't after `linkedInClickedAt` by more than 5 s (the two writes stamp their time before writing, on separate clocks). `reminderSentAt` isn't before `issuedAt` |
| `certificate-notifications-match` | Every notification of type `certificate.issued` or `certificate.reminder` has a `link.path` of `/certificates/<ID>` naming a certificate of the same user. A certificate has at most one of each type. A `certificate.reminder` notification's certificate has `reminderSentAt` equal to the notification's `occurredAt` |

Extended, in `notifications.ts`:

| Name | Added rule |
|------|-----------|
| `notification-shape` | `action`, when present, has a non-empty `label` and a `path` starting with `/` |
| `notification-preference-shape` | No preference is stored for a type that has `emailPreferenceType` |

Not a violation: a certificate with no `certificate.issued` notification (issued before this feature), a certificate with `reminderScheduledAt` and no `reminderSentAt` (not due yet, clicked, or emails off).

## Stream features (`STREAM_FEATURES`)

No registration changes.

- The `certificate.issued` and `certificate.reminder` notifications are `notification` INSERTs, which `notification-delivery` already handles.
- The new certificate writes are MODIFYs of `certificate`. Tests assert they match none of the progress, search, analytics and notification filters.

## Stage and runtime config

| Where | Key | Value |
|-------|-----|-------|
| `StudentPortalComponentConfig` (`common/infra-config`) | `linkedInOrganizationId?: string` | The stage's LinkedIn organisation page ID, digits only. Unset by default |
| Portals' runtime config, `connection` namespace | `site: { name, linkedInOrganizationId? }` | From `siteName` (default "Discava") and the key above. `LOCAL_DEV_CONFIG` sets `{ name: 'Discava' }` |
| Runtime config, `certificates` namespace | `Reminder: { lambdaArn, schedulerRoleArn, scheduleGroupName }` | What the recalculation Lambda needs to create a schedule |
| `LOCAL_EVENT_RUNNER` (`common-server-utils/local-dev`) | `certificateReminderDelaySeconds: 3600` | The local default delay |
