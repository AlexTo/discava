# Implementation Plan: Deploy-Time Settings for Backend Functions

**Branch**: `20261122-093927-runtime-config-env` | **Date**: 2026-11-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261122-093927-runtime-config-env/spec.md`

## Summary

Every backend Lambda stops fetching its settings from AppConfig and gets them as environment variables at synth time. Each variable holds the same object AppConfig holds today, as JSON, under one name per object: `DISCAVA_<NAMESPACE>_<KEY>` (research R-2, R-4).

- **Page renderer**: it can't reference Data's values, because its stack deploys first. It reads one free Systems Manager standard parameter, `/<stage>/page-renderer`, that Data writes, once per instance (R-3).
- **AppConfig resources**: all of them are removed. The `RuntimeConfig` stack keeps only the portals' `runtime-config.json` deployments and becomes `PortalConfig`.
- **Rollout**: switch PRs leave AppConfig in place and unread. The removal PR deletes it, after an operator deletes the old `RuntimeConfig` stack on each stage, so no deploy trips over a cross-stack export still in use (R-8).

Facts the repo showed that shaped the plan:

1. **AppConfig is read at runtime in 10 places.**
   - In `packages/databases`: `core-table/src/client.ts` (`dynamodb.CoreTable`) and `search/src/client.ts` (`opensearch.Search`).
   - In `common-server-utils`:
     - `lesson-media-bucket.ts`: `resolveAppConfigValue`, used for `s3.*.bucketName` and by the readers below;
     - `lesson-media.ts`: `s3.LessonMediaBucket`, the CloudFront signing fields;
     - `cleanup-scheduler.ts`: `mediaConvert.TranscodeCleanup`;
     - `caption-translation-settings.ts`: `captionTranslation.Settings`, which defaults to off.
   - In `packages/apis`: `instructor-api/src/helpers/mediaconvert-client.ts` (`mediaConvert.VideoTranscodePipeline`) and `core-api/src/page-renderer/handler.ts` (`s3.PublicMediaBucket`).
   - In `packages/events`: `media/transcribe-client.ts` (`mediaConvert.CaptionLanguageCode`, never published, defaults) and `certificates/reminder-schedule.ts` (`certificates.Reminder`).
2. **About 20 places hand a function `RUNTIME_CONFIG_APP_ID` and `grantReadAppConfig`.**
   - The construct-level APIs: `core-api.ts`, `instructor-api.ts`, `admin-api.ts` and `stripe-webhook-api.ts`.
   - The stacks: `data-stack.ts` (the pre-token trigger, and the page renderer's role through a mutable import), `core-api-stack.ts` (reindex, unsubscribe), `media-pipeline-stack.ts` (three handlers) and `stream-router-stack.ts` (`grantAppConfig`, every feature handler).
   - The page renderer gets the application's *name* in `student-portal.ts`.
3. **`RuntimeConfig` (`common-constructs/src/core/runtime-config.ts`) does two jobs.**
   - It creates the AppConfig application, environment and strategy in Data, and a profile, hosted version and deployment per namespace in the `RuntimeConfig` stack (`placeIn`, `application-stage.ts`).
   - It holds the `connection` namespace, which `static-website.ts` writes to each portal's `runtime-config.json` from the `RuntimeConfig` stack.
4. **The index-sync custom resource already gets the search endpoint as `OPENSEARCH_ENDPOINT`.** It runs before the content is published.
5. **Two silent fallbacks exist.** `transcribe-client.ts` falls back to the stage's caption language, and `caption-translation-settings.ts` falls back to off.
6. **`deploy.yml` deploys `main` on every successful CI run when `AUTO_DEPLOY_STAGE` is set.** Any manual rollout step has to happen before the PR that needs it is merged.
7. **`scripts/setup-stage.sh` gives the deploy execution role AppConfig rights** (`AppConfigForDiscava`) and the permissions boundary `appconfig:GetLatestConfiguration` and `StartConfigurationSession`. Neither has rights on a stage-owned Systems Manager parameter.
8. **The ops scripts `seed-categories` and `rebuild-analytics` target a stage when `RUNTIME_CONFIG_APP_ID` is set**, and `first-deploy.mdx` reads it from the `RuntimeConfigApplicationId` output.

## Technical Context

**Language/Version**: TypeScript (Node 24 Lambdas, CDK app), pnpm/Nx monorepo

**Primary Dependencies**:
- `aws-cdk-lib`: `aws-lambda` `addEnvironment`, `aws-ssm` `StringParameter`.
- `@aws-sdk/client-ssm`, new in `core-api`, for the page renderer only.
- Removed where no longer used: `@aws-lambda-powertools/parameters` and `@aws-sdk/client-appconfigdata`.

**Storage**: no table, entity or index change. One Systems Manager standard parameter per stage (`/<stage>/page-renderer`).

**Testing**:
- vitest unit tests for each reader.
- CDK `Template` assertions in `packages/infra/src/stacks/*.test.ts`, `application-stage.test.ts` and the constructs' tests.
- `scripts/setup-stage.sh`'s tests in `packages/tooling/deploy/src/setup-stage.test.ts`.
- The existing Playwright e2e suite, unchanged (local dev takes the `LOCAL_DEV` paths).
- A human walk of the deployed flows.

**Target Platform**: AWS Lambda, CloudFormation, Systems Manager Parameter Store (deployed); `pnpm dev` (local, unchanged).

**Project Type**: serverless backend and infrastructure. No portal or API contract change.

**Performance Goals**:
- No configuration-service call on any cold start.
- The first invocation after a cold start is no slower, and usually faster (R-11).
- The page renderer makes at most one `GetParameter` call per instance.

**Constraints**:
- No stack dependency cycle, and deploy order unchanged (FR-007).
- 4 KB maximum environment per function.
- Secrets stay in Secrets Manager (FR-005).
- No existing test weakened except where a task names the change (FR-019).
- Each PR deployable over an existing stage (FR-012). `discava-production` keeps its hardened settings.
- SPDX headers are generator-managed.

**Scale/Scope**:
- About 30 Lambda functions across 7 stacks.
- 10 runtime readers, 8 published objects (`dynamodb.CoreTable`, `opensearch.Search`, three `s3.*`, two `mediaConvert.*`, `certificates.Reminder`) plus `captionTranslation.Settings`.
- `mediaConvert.CaptionLanguageCode` is read but never published, so it keeps its default.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | Lambda environment and one Parameter Store parameter, both managed AWS features. Removes a service rather than adding one |
| II. Generators first | Pass | No new project, function or component. Existing generator-owned Lambda wrappers keep their shape; only stacks and constructs change |
| III. Everything runs locally | Pass | Every reader keeps its `LOCAL_DEV` branch and local values from `common-server-utils/local-dev`. The page renderer's local server (`local-page-renderer.ts`) never reads the parameter. No new AWS service is needed locally |
| IV. Layered tests | Pass, planned | Unit tests per reader (FR-018), stack tests that pin every setting to its grant (R-7), and the unchanged e2e suite with its invariant check (FR-020). No user flow changes, so no new e2e scenario. Impact check: no shared record is touched |
| V. Single-table via ElectroDB | Pass | The table is still reached only through `@discava/core-table`. Only how it learns the table name changes. No access pattern changes |
| VI. Secure by default | Pass | Least privilege improves: functions lose every `appconfig:*` permission. The page renderer gains `ssm:GetParameter` on one parameter. The parameter holds a table name and a public URL, not a secret, so a standard `String` parameter is enough. The execution role and boundary gain rights scoped to `parameter/<stage>/*` |
| VII. Change freely before launch | Pass | `RUNTIME_CONFIG_APP_ID`, `OPENSEARCH_ENDPOINT` and the AppConfig readers are replaced outright with no alias. The switch PRs leave AppConfig resources in place for one deploy only to keep CloudFormation exports valid (R-8), not as a fallback: nothing reads them |
| VIII. Repo conventions | Pass | The shared reader is a public module of `common-server-utils` (`settings.ts`), used by two or more Lambdas. Single-consumer code stays beside its consumer (`page-renderer/helpers/`). Docs in English, translations noted in the PR |

**Complexity Tracking**: empty.

**Re-check after design**: still passing. The one new runtime call (the page renderer's parameter read) is free, bounded by reserved concurrency, and only exists because of a stack-order constraint (R-3).

## Impact Check (shared records)

This feature writes no record and reads none in a new way. Every function reads the same table, through the same `@discava/core-table` client, and learns its name differently. No invariant is added or extended. The e2e invariant check after every test stays as it is.

## Design Decisions (detail in [research.md](./research.md))

1. **One environment variable per published object, same JSON shape (R-2, R-4).** Contract: [settings-readers.md](./contracts/settings-readers.md). The name is `DISCAVA_<NAMESPACE>_<KEY>`, from `settingEnvName(namespace, key)` in `@discava/common-server-utils/settings`. `readSetting<T>(namespace, key)` parses it, caches nothing (it's an environment read), and throws naming the variable when it's absent.
2. **The construct that owns a resource sets its variable (R-5).** Contract: [infra-settings.md](./contracts/infra-settings.md).
   - `bindSettings(fn)` on `CoreTable`, `LessonMediaBucket`, `LessonMediaUploadBucket`, `PublicMediaBucket`, `OpenSearchCollection` and `VideoTranscodePipeline`.
   - The stacks set the three stack-level objects with `addSetting(fn, namespace, key, value)`.
   - Each call sits where the grant is today.
3. **Page renderer through one parameter (R-3).** Data writes `/<stage>/page-renderer` and grants the renderer's role read on it. The renderer reads it once, then gives the table name to `@discava/core-table` by setting `DISCAVA_DYNAMODB_CORE_TABLE` in its own process before the first table read.
4. **Stack tests replace the runtime safety net (R-7).** `functionsMissingSettings` catches table and search grants without the variable. Explicit per-function tables catch the rest. A stage test bans AppConfig and environments over 4 KB.
5. **`RuntimeConfig` keeps only `connection`.** The class becomes a holder for the portals' `connection` namespace and their `runtime-config.json` deployment. Its AppConfig code (the aspect, `placeIn`, `appConfigApplicationId`, `grantReadAppConfig`, `runtimeConfigApplicationName`) is deleted in the removal PR. The stack is renamed `PortalConfig` (spec FR-010).
6. **Rollout in PRs that each deploy cleanly (R-8).** Contract: [rollout.md](./contracts/rollout.md). Switch PRs only drop imports. The removal PR needs `<stage>/RuntimeConfig` deleted by hand first, which is a human task before merge.
7. **Operators use the same variable (R-9).** Data outputs `CoreTableName`, and the scripts run against a stage when `DISCAVA_DYNAMODB_CORE_TABLE` is set.

## Project Structure

### Documentation (this feature)

```text
specs/20261122-093927-runtime-config-env/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── settings-readers.md
│   ├── infra-settings.md
│   └── rollout.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
packages/
├── common/server-utils/src/
│   ├── settings.ts                     # NEW public module: settingEnvName, readSetting, readOptionalSetting (+ test)
│   ├── lesson-media-bucket.ts          # resolveAppConfigValue removed; resolveBucketName reads settings (+ test)
│   ├── lesson-media.ts                 # CloudFront signing config from settings (+ test)
│   ├── cleanup-scheduler.ts            # mediaConvert.TranscodeCleanup from settings (+ test)
│   └── caption-translation-settings.ts # optional setting, same clamp and default (+ test)
├── databases/core-table/src/client.ts  # DISCAVA_DYNAMODB_CORE_TABLE (+ test)
├── databases/search/src/client.ts      # DISCAVA_OPENSEARCH_SEARCH replaces OPENSEARCH_ENDPOINT and AppConfig (+ test)
├── apis/instructor-api/src/helpers/mediaconvert-client.ts   # mediaConvert.VideoTranscodePipeline (+ test)
├── apis/core-api/src/page-renderer/
│   ├── handler.ts                      # media base URL and table name from the parameter
│   └── helpers/page-renderer-settings.ts  # NEW: reads /<stage>/page-renderer once (+ test)
├── events/src/
│   ├── media/transcribe-client.ts      # optional mediaConvert.CaptionLanguageCode (+ test)
│   ├── certificates/reminder-schedule.ts   # certificates.Reminder (+ test)
│   └── identity/pre-token-generation.ts    # comment only: no AppConfig lookup in the budget
├── common/constructs/src/
│   ├── core/runtime-config.ts          # AppConfig code removed (removal PR); keeps `connection`
│   ├── core/dynamodb.ts, media-bucket.ts, upload-bucket.ts, public-bucket.ts, opensearch.ts   # bindSettings (+ tests)
│   ├── app/media-convert/video-transcode-pipeline.ts   # bindSettings (+ test)
│   ├── app/apis/{core,instructor,admin}-api.ts, stripe-webhook-api.ts   # settings instead of RUNTIME_CONFIG_APP_ID (+ tests)
│   └── app/static-websites/student-portal.ts   # PAGE_RENDERER_PARAMETER instead of RUNTIME_CONFIG_APP_ID
├── infra/src/
│   ├── stages/application-stage.ts     # PortalConfig stack; placeIn removed (+ test)
│   └── stacks/{data,core-api,media-pipeline,stream-router,websites,instructor-api,admin-api,payments}-stack.ts (+ tests, stack-test-fixture.ts)
├── tooling/deploy/src/
│   ├── seed-categories/seed.ts, analytics/rebuild-analytics.ts   # DISCAVA_DYNAMODB_CORE_TABLE
│   └── setup-stage.test.ts             # parameter rights, AppConfig rights removed
scripts/setup-stage.sh                  # execution role + boundary: parameter/<stage>/*; AppConfig removed
docs/src/content/docs/en/               # architecture/aws.mdx, architecture/security.mdx, design/public-pages.mdx,
                                        # design/stream-event-router.mdx, deploy/first-deploy.mdx
packages/infra/CLAUDE.md, packages/tooling/deploy/CLAUDE.md, packages/tooling/deploy/README.md, CONTRIBUTING.md
```

**Structure Decision**: no new package. The reader is a `common-server-utils` module because seven Lambdas' code paths share it, and `common-constructs` already depends on `common-server-utils`, so the construct side imports the same name function. `core-table` and `search` don't depend on `common-server-utils`, so each reads its one variable by its literal name, pinned by a stack test.

## Phases the work splits into (agent-sized pull requests)

`tasks.md` has the detail. The order and the independence:

1. **Foundation**:
   - the `settings` module and its tests;
   - the `bindSettings`, `addSetting` and `pageRendererParameterName` helpers;
   - `functionsMissingSettings` in the stack fixture;
   - the `setup-stage.sh` parameter rights.

   Nothing reads the settings yet, so behaviour doesn't change.
2. **Switch everything that reads the table or search** (US1, US5, MVP):
   - `core-table` and `search` read settings, and every function granted on the table or collection gets the variable;
   - the page renderer reads its parameter, which Data creates;
   - the operator scripts use `DISCAVA_DYNAMODB_CORE_TABLE` and Data's `CoreTableName` output;
   - index sync moves to the new name.

   These go together because once `@discava/core-table` reads its setting, any table reader left on AppConfig breaks. A function loses `RUNTIME_CONFIG_APP_ID` and its AppConfig grant once it reads nothing else from AppConfig. **Human, before merge**: re-run `scripts/setup-stage.sh` for each stage.
3. **Switch buckets, media and schedulers** (US1): the `common-server-utils` readers, `mediaconvert-client`, `transcribe-client`, `reminder-schedule` and caption translation settings. After this, no function has `RUNTIME_CONFIG_APP_ID` or an AppConfig grant.
4. **Remove AppConfig and rename to `PortalConfig`** (US3, US4): the AppConfig code in `RuntimeConfig`, `placeIn`, the stage test that bans AppConfig, the `setup-stage.sh` AppConfig rights, and the dependencies. **Human, before merge**: delete `<stage>-RuntimeConfig` on each existing stage.
5. **Docs, then the deployed checks** (US2): architecture, security and design pages, the nested `CLAUDE.md` files, and CONTRIBUTING's "how a function gets a setting". **Human**: the quickstart walk on `discava-development`, and Cost Explorer the next day.

Phases 2 and 3 each leave `main` deployable: a function either reads settings or still reads AppConfig, which still exists. Phase 4 needs phases 2 and 3 merged and deployed on every stage first.
