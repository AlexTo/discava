# Quickstart: Validating Notifications

Prerequisites: Docker running; `pnpm i`; once, `pnpm --filter @discava/e2e exec playwright install chromium`.

## Automated

```sh
pnpm nx run-many --target test --projects=@discava/core-table,@discava/core-api,@discava/events,@discava/common-server-utils,@discava/common-shadcn,@discava/student-portal,@discava/instructor-portal,@discava/admin-portal
pnpm nx e2e @discava/e2e        # includes notification.e2e.ts and the duplicate-publish race
pnpm build                       # synth, checkov and the stack resource count
```

The e2e scenario makes its own users and uniquely named data and ends with the core-table invariant check, which now includes the notification checks.

## By hand (local stack)

1. `pnpm dev`. The event runner lists a `notification-delivery` queue (`GET http://localhost:2024/router/queues`).
2. Sign in as Bob in the student portal. The bell shows no badge; opening it shows "You're all caught up."
3. Publish a notification for Bob. A small local script (task T017, `@discava/common-scripts:notify-local`) calls `publishNotification` with a registered type. Within a minute (or when you refocus the window) the badge shows 1.
4. Open the bell: the notification is bold with a dot; select it. You land on its link, the dot clears, the badge disappears. Run the script again with the same dedupe key: still one notification.
5. Open `http://localhost:2024/inbox`. The email is listed with Bob's address, the title and an unsubscribe link. Open it and check the text, HTML and the two headers.
6. Open the unsubscribe link in a private window: nothing changes until you press "Stop these emails". Press it, then publish again: a new notification appears in the bell, and no new email appears in the inbox. In settings, the type shows off. Turn it on again and publish: the email returns.
7. Audience: have Bob and Dan enrolled in a course, run the script's course audience mode for that course: each gets one notification, and publishing the same key again changes nothing.
8. `pnpm nx run @discava/common-scripts:reset-local-data` (with `pnpm dev` stopped) empties the inbox.

## Deployed stage (human)

Set `notifications.fromAddress` and `sesIdentity` for `discava-development`, verify the identity in SES (and, in the sandbox, the recipient), deploy, publish one notification, and check the email arrives, its unsubscribe link and one-click header work (the mailbox provider's "unsubscribe" button), and the failure queue is empty.
