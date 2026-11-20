# Contract: notifications, email and the reminder

## Registry (`core-table/src/helpers/notification-types.ts`)

```ts
interface NotificationType<P extends string = string> {
  // …existing fields…
  /** This type's email follows the named type's setting, unsubscribe and label. */
  emailPreferenceType?: string;
  build(params: Record<P, string>): {
    title: string;
    body: string;
    link: { portal: NotificationPortal; path: string };
    /** A second link for the email, in the same portal as `link`. */
    action?: { label: string; path: string };
  };
}
```

The two entries, `certificate.issued` and `certificate.reminder`, are in [data-model.md](../data-model.md). `buildNotification` returns `action` when the type builds one, with `label` cut to 60 characters.

## `isEmailEnabled` (`core-table/src/helpers/notification-preference.ts`)

```ts
isEmailEnabled(service, userId: string, type: string): Promise<boolean>
```

| Type | Answer |
|------|--------|
| Unknown, or policy `never` | `false` |
| Policy `required` | `true` |
| Has `emailPreferenceType` | The answer for that type |
| Otherwise | The stored preference's `emailEnabled`, or the policy's default when none is stored |

It is the one reader of `notificationPreference` for sending. `checkRecipient` in `events/src/notifications/send-email.ts` calls it in place of its own read, with no change in what it decides for existing types.

## Email (`events/src/notifications/email-template.ts` and `send-email.ts`)

`NotificationEmailInput` gains `action?: { label: string; path: string }`. With one:

- HTML: a second button under "Open", with the label, linking to `portalUrl` + `action.path`, in an outline style so "Open" stays the main button.
- Text: a line `<label>: <url>` after `Open: <url>`.
- The label and address are escaped like the title and link.

Without one, the output is byte-for-byte what it is today. The existing template tests stay unchanged.

`sendNotificationEmail` passes `notification.action` through. The unsubscribe token is signed for, and `typeName` taken from, the governing type (`emailPreferenceType` or the type itself), so the reminder's footer reads "You get this because you have Certificates emails on" and its unsubscribe turns `certificate.issued` off.

For the certificate types the email therefore has: subject and heading (the title), the body, "Open" to `/certificates/<ID>`, "Add to LinkedIn profile" to `/certificates/<ID>/linkedin?source=…`, and the usual footer and `List-Unsubscribe` headers.

## Scheduling the reminder (`events/src/certificates/reminder-schedule.ts`)

```ts
scheduleCertificateReminder(params: {
  userId: string;
  courseId: string;
  certificateId: string;   // stored form: names the schedule
  dueAt: string;           // ISO, certificateReminderDueAt(certificate)
}): Promise<void>
```

- Deployed: `CreateScheduleCommand` in the group from runtime config (`certificates` / `Reminder`), name `cert-reminder-<certificateId>`, `at(<dueAt to the second>)`, `FlexibleTimeWindow` off, `ActionAfterCompletion: 'DELETE'`, target the reminder Lambda with `Input` `{ userId, courseId }`. A `ConflictException` is success. Any other error is thrown.
- Local (`isLocalDev()`): `POST /schedules/certificate-reminder` on the event runner with `{ payload: { userId, courseId } }`.

Called from `recalculateStudent` (`events/src/progress/recalculate.ts`):

| Student's state after the progress writes | Step |
|-------------------------------------------|------|
| Not completed, or dropped before completing | Nothing, as today |
| Completed, no certificate | `issueCertificate` (certificate and notification together). Then, if it returned one, schedule and mark |
| Has a certificate with `reminderScheduledAt`, `reminderSentAt` or `linkedInClickedAt` | Nothing: one read, as today |
| Has a certificate with none of the three, due time still ahead | Schedule and mark (repairs a run that stopped between issuing and scheduling) |
| Has a certificate with none of the three, due time passed | Nothing. A reminder is never sent late |

"Schedule and mark" is `scheduleCertificateReminder` then `markCertificateReminderScheduled`. If scheduling throws, the batch fails and is retried.

## The reminder Lambda (`events/src/certificates/certificate-reminder.ts`)

Event: `{ userId: string, courseId: string }` (zod-checked; anything else is logged and dropped).

1. `isEmailEnabled(service, userId, 'certificate.reminder')` is false: stop.
2. `claimCertificateReminder(...)` returns nothing (no certificate, or a click is recorded): stop.
3. `publishNotification` with type `certificate.reminder`, `dedupeKey` the certificate ID, `occurredAt` the claimed `reminderSentAt`, params `certificateId` (display form) and `courseTitle`. `'duplicate'` is success.

| Case | Result |
|------|--------|
| First run, no click, emails on | One notification. The delivery feature emails it |
| Run again (retry, duplicate delivery) | Step 2 returns the stored `reminderSentAt`, step 3 is a duplicate. Still one |
| Crash between the claim and the publish | The retry publishes with the stored time |
| Click recorded before the claim | No reminder |
| Click at the same moment | The claim's condition or the click's decides. Never a claim after a click |
| Emails turned off after the claim, before delivery | The delivery's own check skips the email. The bell notification exists |

Invoked asynchronously by the schedule, with 2 retries and a failure queue (`CertificateReminderFailures`), like `transcode-cleanup`.

## Local event runner (`events/src/local/`)

`POST /schedules/certificate-reminder`, body `LocalScheduleRequest` (`{ payload, delaySeconds? }`): runs the reminder handler with `payload` after `delaySeconds`, default `LOCAL_EVENT_RUNNER.certificateReminderDelaySeconds` (3600). The e2e test and the quickstart post `delaySeconds: 0`.

## Infrastructure (`packages/infra/src/stacks/stream-router-stack.ts`)

- `EventsCertificateReminder`, generated with `ts#lambda-function` like the other `events-*` constructs: read and write on the core table, AppConfig read.
- A `ScheduleGroup` (removal policy destroy, as the cleanup group) and a role assumed by `scheduler.amazonaws.com` that may invoke that Lambda only.
- The progress recalculation Lambda: `grantWriteSchedules` on that group, and `iam:PassRole` on that role with `iam:PassedToService` `scheduler.amazonaws.com`.
- Runtime config `certificates` / `Reminder`: `{ lambdaArn, schedulerRoleArn, scheduleGroupName }`.
- Async invoke: 2 retries, 6 hours' maximum age, on failure to an encrypted SQS queue.

No SES permission is added: the reminder Lambda only writes a notification.
