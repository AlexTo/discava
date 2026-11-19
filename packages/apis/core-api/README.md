# core-api

This library was generated with [Nx](https://nx.dev).

## Building

Run `pnpm nx build @discava/core-api` to build the library.

## Running unit tests

Run `pnpm nx test @discava/core-api` to execute the unit tests via [Vitest](https://vitest.dev/).

## Auth

Procedures built on `protectedProcedure` (see [src/init.ts](src/init.ts)) require `ctx.user`,
which is populated by the auth middleware ([`createAuthPlugin`](../../common/server-utils/src/trpc-middleware.ts))
from `event.requestContext.authorizer.claims`. In the deployed API this is set by CoreApi's
`CognitoUserPoolsAuthorizer`, so `ctx.user` is only missing if the authorizer config changes.

Running `pnpm nx dev @discava/core-api` (or `serve`) starts [src/local-server.ts](src/local-server.ts),
which has no API Gateway in front of it to verify and flatten a token into claims. Instead
`startLocalServer` ([`trpc-local-server.ts`](../../common/server-utils/src/trpc-local-server.ts))
decodes (without verifying the signature) the `Authorization: Bearer <token>` header the
portal sends. Locally that token comes from the local OIDC server that stands in for Cognito,
with the same claims. So `protectedProcedure` procedures work locally once you're signed in
in the browser; calling the local server without a token still rejects with `UNAUTHORIZED`,
same as production.
