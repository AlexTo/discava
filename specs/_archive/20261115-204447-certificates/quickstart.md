# Quickstart: Validating Certificates

Prerequisites: Docker running; `pnpm i`; once, `pnpm --filter @discava/e2e exec playwright install chromium`.

## Automated

```sh
pnpm nx run-many --target test --projects=@discava/core-table,@discava/core-api,@discava/instructor-api,@discava/events,@discava/student-portal,@discava/instructor-portal
pnpm nx e2e @discava/e2e        # includes certificate.e2e.ts and the double-recalculation race
pnpm build
```

## By hand (local stack)

1. `pnpm dev`; sign in as Alice (instructor) and publish a course with one text lesson. Check the course settings switch is on.
2. As Bob (student), enrol and complete the item. Within seconds My Learning shows the course complete with a Certificate control.
3. Download PDF: it shows Bob's name, the course title, today's date, the certificate ID and the verification URL. Copy link.
4. Open the link in a private window (signed out): name, course, date and ID, nothing else. Change a letter of the ID: "Certificate not found".
5. As Alice, turn certificates off; as Dan, enrol and complete: no certificate. Bob's certificate still verifies.
6. Save screenshots of the key steps to `tmp/screenshots/pr-<number>/`.

## Expected data afterwards

- One `certificate` for Bob and that course; none for Dan.
- Core-table invariants pass.
