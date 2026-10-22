# @discava/student-portal
This library was generated with [@aws/nx-plugin](https://github.com/awslabs/nx-plugin-for-aws/).

## Building

Run `pnpm nx build @discava/student-portal [--skip-nx-cache]` to build the application.

## Run dev server

Run `pnpm nx serve @discava/student-portal`

## Running unit tests

Run `pnpm nx test @discava/student-portal` to execute the unit tests via Vitest.

### Updating snapshots

To update snapshots, run the following command:

`pnpm nx test @discava/student-portal --configuration=update-snapshot`

## Run lint

Run `pnpm nx lint @discava/student-portal`

### Fixable issues

You can also automatically fix some lint errors by running the following command:

`pnpm nx lint @discava/student-portal --configuration=fix`

### Runtime config

Deployed, the portal reads `/runtime-config.json`, which the `RuntimeConfig` stack writes to its bucket. In local dev (`pnpm dev`, Vite's `local-dev` mode) it uses `LOCAL_DEV_CONFIG` in `src/components/RuntimeConfig` instead, pointing at the local APIs, S3Mock and OIDC server; no file is needed.

## Useful links

- [React website reference docs](TODO)
- [Learn more about NX](https://nx.dev/getting-started/intro)
