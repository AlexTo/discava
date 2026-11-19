# CLAUDE.md: packages/common/scripts

Loaded when working in `packages/common/scripts`. The repo-wide rules are in the root [CLAUDE.md](../../../CLAUDE.md).

Deploy/destroy tooling, and the Docker services local dev runs instead of AWS, invoked by Nx targets:

- DynamoDB local
- S3Mock for S3 (`@discava/common-scripts:s3mock`)
- the local OIDC server for Cognito (`@discava/common-scripts:local-oidc`), with its own `src/local-oidc/config.json` and sign-in page in `src/local-oidc/login.html`
- `reset-local-data`

S3's settings for the APIs are in `common-server-utils/local-dev` (S3 endpoint, local bucket names) since they're read at runtime; see #137 for what still runs only on dev.
