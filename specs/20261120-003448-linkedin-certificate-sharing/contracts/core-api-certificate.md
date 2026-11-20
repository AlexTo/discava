# Contract: core-api `certificate` router (changes)

`certificate.verify`, `certificate.myCertificates` and `certificate.pdf` keep their inputs and outputs. One procedure is added.

## `certificate.recordLinkedInClick` (mutation, public)

Built on `publicCourseProcedure` and listed in `PUBLIC_OPERATIONS`, after `'certificate.verify'`. It is the API's first public mutation: API Gateway serves its `POST` without the Cognito authorizer and under the shared public throttle, with no construct change (research R-3).

### Input

```ts
RecordLinkedInClickInputSchema = z.object({
  // Any case, with or without dashes or spaces, as certificate.verify takes it.
  certificateId: z.string().max(64),
  source: z.enum(['my-learning', 'certificate-page', 'issued-email', 'reminder-email']),
});
```

### Output

```ts
RecordLinkedInClickOutputSchema = z.object({});
```

### Behavior

| Case | Result |
|------|--------|
| A certificate with this ID, no use recorded yet | `linkedInClickedAt` (now) and `linkedInClickSource` are stored. `{}` |
| A use is already recorded | Nothing changes. `{}`, the same answer |
| Two calls at the same moment | One is stored. Both get `{}` |
| Malformed or unknown ID | `NOT_FOUND`, "Certificate not found": the same message `certificate.verify` gives for both |
| `source` isn't one of the four | `BAD_REQUEST` (zod) |
| Signed in or signed out, owner or not | The same. The caller's identity isn't read |

Rules:

- It calls `recordLinkedInClick` in core-table and does no table write of its own.
- The output never carries anything from the certificate. A test asserts it has no keys.
- It never unsets or overwrites a recorded use. A test calls it twice with different sources and reads back the first.
- It makes no outbound request. Nothing is sent to LinkedIn (spec FR-008).

## `certificate.verify` (unchanged)

Still returns exactly `certificateId`, `learnerName`, `courseTitle` and `completedAt`. Its existing "no other keys" test stays as it is: the new attributes must not appear in it.

## `certificate.myCertificates` (unchanged)

The verification page calls it, when the viewer is signed in, to decide whether they own the certificate on the page (research R-9).

## `notification.preferences` and `notification.setPreference` (behavior change)

- The list leaves out any type that has `emailPreferenceType`, so `certificate.reminder` has no row and `certificate.issued` appears as "Certificates".
- Setting a preference for `certificate.reminder` is refused with `BAD_REQUEST`, as a `required` type is today (`setNotificationPreference` throws `InvalidRequestError`).
