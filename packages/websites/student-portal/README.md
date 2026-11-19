# @discava/student-portal
This library was generated with [@aws/nx-plugin](https://github.com/awslabs/nx-plugin-for-aws/).

## Building

Run `pnpm nx build @discava/student-portal [--skip-nx-cache]` to build the application.

## Run dev server

Run `pnpm nx dev @discava/student-portal`, which also starts the local OIDC server and the APIs the portal calls (`pnpm dev` starts everything)

## Running unit tests

Run `pnpm nx test @discava/student-portal` to execute the unit tests via Vitest.

### Updating snapshots

To update snapshots, run the following command:

`pnpm nx test @discava/student-portal -u`

## Run lint

Run `pnpm nx lint @discava/student-portal`

### Fixable issues

You can also automatically fix some lint errors by running the following command:

`pnpm nx lint @discava/student-portal --configuration=fix`

### Runtime config

Deployed, the portal reads `/runtime-config.json`, which the `RuntimeConfig` stack writes to its bucket. In local dev (`pnpm dev`, Vite's `local-dev` mode) it uses `LOCAL_DEV_CONFIG` from `src/local-dev-config.ts` instead (passed to `RuntimeConfigProvider` from `@discava/common-web-utils/runtime-config` in `src/main.tsx`), pointing at the local APIs, S3Mock and OIDC server; no file is needed.

## Useful links

- [Learn more about NX](https://nx.dev/getting-started/intro)
