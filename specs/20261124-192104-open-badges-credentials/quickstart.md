# Quickstart: Checking Verifiable Credentials by Hand

**Feature**: [spec.md](./spec.md)

## Locally (`pnpm dev`)

1. As **Alice**, make sure a published course has certificates on. As **Bob**, enrol and complete it; the certificate appears in My Learning within seconds.
2. **Story 1**: in My Learning choose **Download credential**. Open the file: the course title, Bob's name, the certificate ID, `issuer.id` `http://localhost:2026/credentials/issuer`, a `credentialStatus` and a `proof` with `eddsa-rdfc-2022`. No email in plain text.
3. **Story 2**: open `http://localhost:2026/credentials/issuer`: the platform name and one `Multikey`. Open the `statusListCredential` URL from the file: a signed list. Run the e2e helper's verifier on the file (`pnpm --filter @discava/e2e exec tsx src/helpers/verify-credential.ts <file>`): "valid, not revoked". Change one letter of the course title in the file and run it again: "invalid signature".
4. Open the public page as Bob (signed in): the two download buttons. Signed out, and as Dan: the line about verifiable credentials, no buttons.
5. **Story 3**: as Alice, revoke Bob's certificate (course → Certificates). Run the verifier on the file from step 2: "revoked". As Carol, restore it, and run it again: still "revoked" (a revocation is final). As Bob, download the credential again: its `id` and status index are new, and the verifier says "valid" for the new file and "revoked" for the old one. (Locally there is no CDN cache; on a stage allow 5 minutes.)
6. **Story 4**: as Bob, **Download badge image**. It opens in a browser as a badge with the course title. The verifier helper accepts the `.svg` too.

## On `discava-development`

1. Complete a course and download the credential and badge image.
2. Upload the JSON to the 1EdTech validator (<https://vc.1ed.tech>) and to DCC's VerifierPlus (<https://verifierplus.org>): both report a valid signature (SC-001). Note what each says about the issuer (VerifierPlus may mark it as not in a registry; that is expected, see the plan's risks).
3. Revoke the certificate, wait 5 minutes, check again in both: revoked (SC-003). Restore it and download the credential again: the new file is valid in both, and the old one is still revoked.
4. `aws kms describe-key` on the stage's credential key: `KeySpec` `ECC_NIST_EDWARDS25519`, and its key policy lets only the `Credentials` function and the page renderer sign.
