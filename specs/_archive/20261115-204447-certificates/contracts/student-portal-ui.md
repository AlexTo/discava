# Contract: portal UI

## Public verification page: `/certificates/$certificateId` (student portal)

Reachable signed out (no `beforeLoad` redirect to sign-in; the portal already has public routes such as the catalogue). Calls `certificate.verify`.

| State | Shows |
|-------|-------|
| Loading | a skeleton, no learner data |
| Found | "Certificate of completion", the learner's name, the course title, the completion date (long local format), the certificate ID (display form). Nothing else about the learner |
| Not found (unknown or malformed ID) | "Certificate not found" and a link to the home page |
| Error | a generic retryable message |

No sign-in prompts, no navigation requiring auth. The page works with a lowercase or dash-less ID.

## My Learning (student portal)

For each completed course whose ID is in `certificate.myCertificates`, beside the completed state, a Certificate control (text only, no arrow icons) opening a menu or inline buttons:

- **View**: opens `/certificates/<ID>` in a new tab.
- **Download PDF**: calls `certificate.pdf`, saves `fileName`; shows "Preparing" while waiting and a retryable error on failure.
- **Copy link**: copies `<window.location.origin>/certificates/<ID>`; confirms with "Link copied".

Courses without a certificate show none of these.

## Instructor portal: course settings

A switch "Issue a certificate on completion" with a one-line note "Applies to students who complete the course from now on; certificates already issued stay valid." Calls `course.setCertificates`; shows the saved state; failure shows an error and restores the switch. Visible to course instructors.
