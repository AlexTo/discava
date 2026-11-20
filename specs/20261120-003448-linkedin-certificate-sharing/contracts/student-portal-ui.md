# Contract: student portal

## The LinkedIn address (`src/lib/linkedin-add-to-profile.ts`)

```ts
buildLinkedInAddToProfileUrl(input: {
  courseTitle: string;       // as printed on the certificate
  completedAt: string;       // ISO, as printed on the certificate
  certificateId: string;     // display form, XXXX-XXXX-XXXX-XXXX
  verifyUrl: string;         // absolute: <origin>/certificates/<certificateId>
  issuer: { name: string; linkedInOrganizationId?: string };
}): string
```

| Parameter | Value |
|-----------|-------|
| base | `https://www.linkedin.com/profile/add` |
| `startTask` | `CERTIFICATION_NAME` |
| `name` | `courseTitle` |
| `organizationId` | `issuer.linkedInOrganizationId`, when set |
| `organizationName` | `issuer.name`, only when no organisation ID is set |
| `issueYear` | the UTC year of `completedAt` |
| `issueMonth` | the UTC month of `completedAt`, 1 to 12, no leading zero |
| `certUrl` | `verifyUrl` |
| `certId` | `certificateId` |

- Built with `URLSearchParams`, so every value is encoded.
- No other parameter, ever. The function's test compares the full set of parameter names against this table and fails on an extra one (spec SC-004).
- The format isn't confirmed with LinkedIn (research R-1). If the **(human)** check finds a difference, this table and the test change together.

The issuer comes from `useRuntimeConfig().site`. The origin for `verifyUrl` is `window.location.origin`.

## "Add to LinkedIn profile" in My Learning (`routes/my-learning/-components/certificate-actions.tsx`)

- A fourth action after View, Download PDF and Copy link: `Button variant="outline" size="sm" asChild` around an `<a>` with the address above, `target="_blank"` and `rel="noopener noreferrer"`. Text label only, no icon.
- `CertificateActions` takes two more props from `certificate.myCertificates`: `courseTitle` and `completedAt`.
- On click it calls `certificate.recordLinkedInClick({ certificateId, source: 'my-learning' })` and doesn't wait for it. The link's own navigation opens LinkedIn. A failed call shows nothing and isn't retried.
- Shown whenever the certificate actions are shown, whether or not a use is already recorded. Nothing on the page says "added" (spec FR-010).

## The verification page (`routes/certificates/$certificateId/index.tsx`)

For everyone: unchanged, and still one `certificate.verify` call.

For the owner: when the viewer is signed in, the page also reads `certificate.myCertificates`. If one of them has this certificate's ID, it shows a section under the certificate, `-components/owner-share.tsx`:

- heading "Add this certificate to your LinkedIn profile";
- the same link button, recording with `source: 'certificate-page'`;
- a short list, "What LinkedIn asks for", with the values to copy: Name (course title), Issuing organisation (site name), Issue date (month and year), Credential ID, Credential URL;
- one line: "We can't see your LinkedIn profile, so this button stays here after you've used it."

Signed out, still loading the sign-in state, or not the owner: the section isn't rendered, and `certificate.myCertificates` isn't called when signed out.

## The email's route (`routes/certificates/$certificateId/linkedin.tsx`)

Public. Search parameter `source`: `issued-email` or `reminder-email`, anything else is read as `issued-email`.

1. Reads the certificate with `certificate.verify`.
2. Calls `certificate.recordLinkedInClick({ certificateId, source })`, waiting at most 2 seconds.
3. Replaces the page with the LinkedIn address (`window.location.replace`), whether step 2 worked, failed or timed out.

| State | Shown |
|-------|-------|
| Working | "Opening LinkedIn…" and a link, "Continue to LinkedIn", with the same address, for a browser that blocks the redirect |
| Unknown or malformed ID | "Certificate not found", as the verification page shows it |
| `certificate.verify` fails otherwise | An `ErrorAlert` with "Try again" |

The page sets `<meta name="referrer" content="no-referrer">` while mounted, so the redirect doesn't tell LinkedIn the address it came from.

## Runtime config

`site: { name: string; linkedInOrganizationId?: string }` in the portal's runtime config. `src/local-dev-config.ts` sets `site: { name: 'Discava' }`.

## Tests

- `lib/linkedin-add-to-profile.test.ts`: the full address for one certificate; a title with `&`, `#`, accents and emoji round-trips through `URLSearchParams`; the month has no leading zero and uses UTC at a month boundary; `organizationId` replaces `organizationName`; the parameter-name set equals the table.
- `routes/my-learning/-my-learning.test.tsx`: the link's `href`, `target` and `rel`; a click calls `certificate.recordLinkedInClick` with `my-learning`; a failing handler shows no alert; no link on a course without a certificate.
- `routes/certificates/$certificateId/-certificate.test.tsx`: owner sees the section and the values; another signed-in user doesn't; signed out doesn't and `certificate.myCertificates` isn't called; a click records `certificate-page`.
- `routes/certificates/$certificateId/-linkedin.test.tsx`: records with the source from the address, then replaces the location with the LinkedIn address; a failing or slow record still redirects; an unknown ID shows "Certificate not found" and doesn't redirect.
