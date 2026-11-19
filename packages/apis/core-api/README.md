# core-api

This library was generated with [Nx](https://nx.dev).

## Building

Run `nx build core-api` to build the library.

## Running unit tests

Run `nx test core-api` to execute the unit tests via [Vitest](https://vitest.dev/).

## Auth

Procedures built on `protectedProcedure` (see [src/init.ts](src/init.ts)) require `ctx.user`,
which is populated by the auth middleware ([`createAuthPlugin`](../../common/server-utils/src/trpc-middleware.ts))
from `event.requestContext.authorizer.claims`. In the deployed API this is set by CoreApi's
`CognitoUserPoolsAuthorizer`, so `ctx.user` is only missing if the authorizer config changes.

Running `nx dev core-api` (or `nx serve core-api`) starts [src/local-server.ts](src/local-server.ts),
which has no API Gateway in front of it to verify and flatten a Cognito token into claims. Instead
it decodes (without re-verifying the signature) the real `Authorization: Bearer <token>` header the
frontend already sends — see `CoreApiClientProvider` — since the token itself still comes from a
genuine sign-in against the real Cognito user pool. So `protectedProcedure` procedures work locally
as long as you're signed in in the browser; calling the local server without a token still rejects
with `UNAUTHORIZED`, same as production.
