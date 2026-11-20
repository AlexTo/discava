# Quickstart: checking LinkedIn certificate sharing

## Prerequisites

- Docker running, `pnpm i` done, `pnpm dev` running.
- A published course with certificates on and one short item. Sign in to the instructor portal as Alice to make one, or run `pnpm nx run @discava/e2e:seed-local-courses`.
- A LinkedIn account, for steps 3 and 12 only.

## Automated checks

```sh
pnpm nx run @discava/core-table:test -- --run certificate notification-types notification-preference invariants
pnpm nx run @discava/core-api:test -- --run certificate.test.ts notification.test.ts router.test.ts render
pnpm nx run @discava/events:test -- --run recalculate certificate-reminder reminder-schedule email-template send-email
pnpm nx run @discava/student-portal:test -- --run linkedin certificate my-learning
pnpm nx run @discava/infra:synth
pnpm nx e2e @discava/e2e -- --grep "certificate"
```

All pass. The e2e tests post their screenshots on the PR.

## By hand (local stack)

Sign in to the student portal (`http://localhost:4201`) as Bob, enrol in the course and complete it.

1. **The action.** Open My Learning. Within about 30 seconds the course shows Certificate actions, now with "Add to LinkedIn profile". Hover it: the address starts `https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME` and carries only `name`, `organizationName`, `issueYear`, `issueMonth`, `certUrl` and `certId`.
2. **The record.** Click it. LinkedIn opens in a new tab. In the browser's network panel, one `certificate.recordLinkedInClick` call was made with `source: "my-learning"`. Click again: the call is made, and the stored record doesn't change.
3. **LinkedIn's form (needs a LinkedIn account).** In the new tab, note which fields LinkedIn filled in. This is the check research R-1 asks for.
4. **The notification.** The bell shows "Your certificate for <course> is ready". It opens `/certificates/<ID>`.
5. **The email.** Open `http://localhost:2024/inbox`. One email has that title, an "Open" button to the certificate and an "Add to LinkedIn profile" button.
6. **One click from the email, signed out.** Copy the email's LinkedIn link into a private window. It shows "Opening LinkedIn…" briefly and lands on LinkedIn's form.
7. **The owner's page.** As Bob, open `/certificates/<ID>`: the section "Add this certificate to your LinkedIn profile" lists the values to copy. In a private window, and signed in as Dan, the same address shows only the certificate.
8. **The reminder.** Complete a second course as Bob, and don't use the action. Make the reminder come due:

   ```sh
   curl -X POST http://localhost:2024/schedules/certificate-reminder \
     -H 'content-type: application/json' \
     -d '{"payload":{"userId":"<Bob sub>","courseId":"<courseId>"},"delaySeconds":0}'
   ```

   One "Add your <course> certificate to LinkedIn" notification and one email appear. Post it again: nothing new.
9. **No reminder after a click.** Post the same for the first course (step 2 recorded a use): nothing is sent.
10. **No reminder with emails off.** Complete a third course, turn "Certificates" off in Settings, Notifications, and post for it: nothing is sent, in the bell or the inbox. The settings page shows one "Certificates" row and no reminder row.
11. **Unsubscribe.** Turn "Certificates" back on, complete another course, and use the email's "Stop these emails" link: the setting is off again.
12. **The preview.** `curl -s http://localhost:2026/certificates/<ID> | grep -E 'og:|<title>|robots'` shows the learner, the course, the date and `noindex`. `curl -s -o /dev/null -w '%{http_code}' http://localhost:2026/certificates/0000-0000-0000-0000` prints `404`. On a deployed stage, paste the address into LinkedIn's Post Inspector and check the card.

Save screenshots of the key steps to `tmp/screenshots/pr-<number>/`.

## On a deployed stage

`pnpm dev` has no EventBridge Scheduler. After deploying to `discava-development`:

- Complete a course and check that a schedule named `cert-reminder-<ID>` exists in the certificate reminder group, due three days after `issuedAt`.
- To see the reminder without waiting, invoke the reminder Lambda with `{ "userId": "…", "courseId": "…" }`.
- Check that the email arrives from the stage's sender with a working one-click unsubscribe.
