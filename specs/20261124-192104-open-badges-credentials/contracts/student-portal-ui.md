# Contract: Student Portal

## My Learning: certificate actions (`components/certificate-actions.tsx`)

For a certificate with `status: 'valid'`, after the existing View, Download PDF, Copy link and Add to LinkedIn profile:

- **Download credential**: calls `certificate.credential({ courseId })` and saves the text as `fileName` with type `application/json`.
- **Download badge image**: calls `certificate.badgeImage({ courseId })` and saves `svg` as `fileName` with type `image/svg+xml`.

Both: text-only buttons (no icons), disabled with "Preparing…" while the call runs, and on failure the existing `ErrorAlert` with the API's message and a retry. For `status: 'revoked'`, neither is shown, as for the other actions.

At phone width the actions wrap as the existing four do; the e2e scenario's phone-width screenshot covers them.

## Public certificate page (`/certificates/<ID>`)

- Valid certificate, any viewer: one line under the statement, "This certificate is also a verifiable credential (Open Badges 3.0). Its owner can download it and anyone can check it with an Open Badges verifier." with "Open Badges 3.0" linking to 1EdTech's page in a new tab (`rel="noopener noreferrer"`).
- Owner (`-components/owner-share.tsx`, the section that already holds the LinkedIn action): the same two buttons as My Learning.
- Revoked or not found: unchanged.

The link preview (page renderer `/certificates/<ID>`) is unchanged.
