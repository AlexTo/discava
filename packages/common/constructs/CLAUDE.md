# CLAUDE.md: packages/common/constructs

Loaded when working in `packages/common/constructs`. The repo-wide rules are in the root [CLAUDE.md](../../../CLAUDE.md); how the stacks compose these constructs is in `packages/infra/CLAUDE.md`.

All CDK constructs live here. A construct owns one component's own resources (e.g. an API with its handlers and WAF) and exposes `grant*`/`restrictCorsTo`-style helpers; `lambda-functions/` holds the generator-owned bare `Function` wrappers.

## How a function gets a setting

Resource names and addresses reach a function as plain `DISCAVA_*` environment variables set at deploy time, one per field (`DISCAVA_DYNAMODB_CORE_TABLE_TABLE_NAME`, named by `settingEnvName`). Call the resource's `bindSettings(fn)` next to its grant, or `addSetting` (`src/core/settings.ts`) for a stack-level value. Read it in code with `readSetting(namespace, key, fields)` from `@discava/common-server-utils/settings`, which throws `Missing deploy-time setting <NAME>` for a missing field; there are no silent fallbacks. Never fetch settings at runtime.
