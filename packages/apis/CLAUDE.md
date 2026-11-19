# CLAUDE.md: packages/apis

Loaded when working in `core-api`, `instructor-api` or `admin-api`. The repo-wide rules are in the root [CLAUDE.md](../../CLAUDE.md).

## The three APIs

- `core-api` (`@discava/core-api`): tRPC API behind API Gateway, for procedures any authenticated user can call: one shared router Lambda, plus dedicated functions for procedures needing more than the table (`CORE_API_DEDICATED_FUNCTIONS`, e.g. `contentItem.videoUrl` holding the CloudFront signing key)
- `instructor-api` (`@discava/instructor-api`): separate tRPC API, separate Lambda/API Gateway, for procedures only instructors may call (e.g. creating/archiving courses); same Cognito user pool as `core-api`
- `admin-api` (`@discava/admin-api`): separate tRPC API, own Lambda/API Gateway (`AdminApi` stack), for procedures only admins may call (the `admin` Cognito group); today the category taxonomy, the Reviews screen's `review.courses`, `review.list` and `review.remove`, and the Stripe connection (`payment.status` on the shared router; `payment.connect`/`payment.disconnect` on the dedicated `PaymentsConnect` function, the only one that may write the two Stripe secrets, see `ADMIN_API_DEDICATED_FUNCTIONS`). Built like `instructor-api`, with `adminProcedure` for the core table

## Shape of an API

The tRPC router (`packages/apis/core-api/src/router.ts`) builds procedures from middleware plugins in `init.ts`; `protectedProcedure` additionally requires `ctx.user`. `src/handler.ts` is the deployed Lambda entrypoint; `src/local-server.ts` is what `nx dev` runs locally and decodes JWTs itself (no API Gateway in front locally). See `createAuthPlugin` in `common-server-utils/trpc-middleware` for how the two are reconciled.

The tRPC plumbing lives once in `packages/common/server-utils`: the middleware plugins and context types (`trpc-middleware`), `createApiBase({ serviceName, requiredGroup? })` for `t`, `publicProcedure` and `protectedProcedure` (`trpc-api-base`), `createHandler(router)` (`trpc-handler`), `startLocalServer({ router, port, extraMiddleware? })` (`trpc-local-server`) and `ZodAsyncIterable` (`z-async-iterable`). Each API keeps only a thin `init.ts`, `handler.ts` and `local-server.ts` passing in its name, group and port. When a new tRPC API is generated with `nx g`, point it at these modules and delete its generated `middleware/`, `handler.ts` and `local-server.ts` copies rather than keeping them.

All three APIs share the `init.ts`/`router.ts`/`handler.ts`/`local-server.ts` shape. `instructor-api` and `admin-api` pass a `requiredGroup` (`instructor`, `admin`), so their `protectedProcedure` throws `FORBIDDEN` for callers outside that Cognito group. Procedures needing the core table build on `protectedProcedure` + `createCoreTablePlugin` (`trpc-middleware`), which exposes `ctx.coreTable`: `courseProcedure` in core-api and instructor-api, `adminProcedure` in admin-api; core-api also has `publicCourseProcedure` and `publicSearchProcedure` for unauthenticated reads.

Any project newly wiring up `@discava/core-table` also needs `electrodb`/`@aws-sdk/client-dynamodb` as direct dependencies (not just transitively via `@discava/core-table`) — without them, `tsc --build` fails with a "cannot be named without a reference" (TS2883) error, since it can't print a portable type for anything touching core-table's `Service`.

## Features that span APIs

- Lesson discussions (#280): core-api's `discussion` procedures serve students and instructors, and instructor-api's `discussion` router the staff queues and moderation. Every write goes through core-table's `discussionWrites` (see `packages/databases/core-table/CLAUDE.md`).
- Adding or restoring a module, lesson or content item goes through instructor-api's `writeAtEnd` (`helpers/order.ts`), which claims its `order` from the parent's `lastChildOrder`.

## Tests

Testing anything that imports `@discava/core-table` needs a `resolve.alias` in that project's `vitest.config.mts` (see instructor-api's) — Vite doesn't resolve it via tsconfig `paths` the way `tsc`/`tsx` do. Procedure tests use the helpers in `@discava/common-server-utils/trpc-testing`: `callerFor(router, { sub, groups, headers, responseCookies })` for a caller as that Cognito user (no `sub` is an anonymous caller), `mockCoreTable({ module: ['get', 'patch'], contentItem: ['query.primary'], transaction: ['write'] })` for typed `vi.fn()` spies named `<entity><Method>` (`moduleGet`, `contentItemQueryPrimary`, `transactionWrite`) plus `mockModule`, which builds the `@discava/core-table` replacement, and the record builders `aCourse`, `aModule`, `aLesson` and `aContentItem`. Create the spies in `vi.hoisted` (see `instructor-api/src/procedures/earnings.test.ts`). A test file over ~1,000 lines is split by procedure or concern, and what the pieces share (spies, fixture records, default mock behaviour) goes in a `<name>.fixtures.ts` beside them, which imports no procedure so a test can hoist it above the procedure imports (see `instructor-api/src/procedures/curriculum-lifecycle*.ts`).
