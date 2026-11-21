---

description: "Task list for deploy-time settings for backend functions"
---

# Tasks: Deploy-Time Settings for Backend Functions

**Input**: Design documents from `/specs/20261122-093927-runtime-config-env/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires tests, and they're included:

- **Unit tests** for the new `settings` module and every reader that changes.
- **CDK stack and construct tests** that pin each function's settings to its grants (research R-7).
- **A stage test** that bans AppConfig and over-sized environments.
- **`setup-stage.sh` tests** for the new and removed permissions.

No user flow changes, so the e2e suite stays as it is and must pass unchanged on PR CI. No shared record is touched, so no invariant is added.

Write each phase's tests first and watch them fail. Never weaken an existing test to make it pass. The only intended test changes are tests that mock AppConfig or assert `RUNTIME_CONFIG_APP_ID`, its error message or AppConfig permissions. They are named in T010, T013, T016 and T017, and must be repeated in those PRs' descriptions.

**Who runs what**: An automated agent implements these tasks without `pnpm dev` or Docker. It runs unit tests, lint, typecheck, `build` and `synth` locally. PR CI runs the e2e suite (`pr-checks.yml`'s `E2E tests` job). Tasks marked **(human)** need a deployed stage, AWS credentials or the owner, and a reviewer does them, some **before merge** (see [contracts/rollout.md](./contracts/rollout.md)).

**Organization**: Six phases, each one agent PR, merged in order. Each leaves `main` green and deployable over `discava-development`: until Phase 5, a function reads either settings or AppConfig, and AppConfig still exists.

| Label | Story | Priority |
|-------|-------|----------|
| US1 | A stage pays nothing to tell its functions their settings | P1 |
| US2 | Everything keeps working after the switch | P1 |
| US3 | The stage no longer carries a configuration service | P2 |
| US4 | Existing stages upgrade in place | P2 |
| US5 | Operator scripts still target a deployed stage | P3 |

US2 has no phase of its own. Its tests run in every phase: each phase's stack tests and the unchanged suite, plus the deployed walk in Phase 6. US4's work is the rollout steps, placed as **(human)** tasks in the phases they gate.

Paths are relative to the repository root. Only the last PR says "Closes #777". Earlier PRs say "Part of #777" and must not use a closing keyword.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)

---

## Phase 1: Foundation - the settings module and construct helpers

**Goal**: One place defines how a setting is named and read, and every resource construct can hand its setting to a function. Nothing reads settings yet, so behaviour doesn't change.

**Independent test**: `pnpm nx run @discava/common-server-utils:test -- --run settings` and `pnpm nx run @discava/common-constructs:test -- --run` pass, and `pnpm nx run-many --target build --projects @discava/common-server-utils,@discava/common-constructs,@discava/infra` succeeds.

- [ ] T001 [P] Tests first, then add `packages/common/server-utils/src/settings.ts` as a public module (`@discava/common-server-utils/settings`), following [contracts/settings-readers.md](./contracts/settings-readers.md). Add it to the package's `exports` the way the other modules are listed. It exports:
  - `settingEnvName(namespace, key)`: `DISCAVA_` plus namespace and key, each split at lower-to-upper case changes, upper-cased and joined with `_`. For example `('s3', 'LessonMediaBucket')` gives `DISCAVA_S3_LESSON_MEDIA_BUCKET`, `('mediaConvert', 'VideoTranscodePipeline')` gives `DISCAVA_MEDIA_CONVERT_VIDEO_TRANSCODE_PIPELINE`, and `('captionTranslation', 'Settings')` gives `DISCAVA_CAPTION_TRANSLATION_SETTINGS`.
  - `readSetting<T>(namespace, key)`: parses the variable's JSON. It throws `Missing deploy-time setting <NAME>` when the variable is unset or empty, and `Invalid deploy-time setting <NAME>` when the value isn't JSON. Neither message may include the value.
  - `readOptionalSetting<T>(namespace, key)`: as `readSetting`, but returns `undefined` when the variable is unset or empty.

  In `settings.test.ts`, cover the name for every row of [data-model.md](./data-model.md)'s catalogue, present, absent, empty and invalid values, and that no error message contains the value.
- [ ] T002 [P] Tests first, then add `packages/common/constructs/src/core/settings.ts` with `addSetting(fn, namespace, key, value)`, which calls `fn.addEnvironment(settingEnvName(namespace, key), typeof value === 'string' ? JSON.stringify(value) : Stack.of(fn).toJsonString(value))`. Export it from the package index. In `settings.test.ts`, check that a value holding a token from another stack synthesises as an import in the function's stack, and that a plain object is its JSON.
- [ ] T003 Tests first, then add `bindSettings(fn)` to each construct that publishes a runtime-config object today. Each calls `addSetting` with exactly the object it passes to `RuntimeConfig.set` (keep the `set` calls: Phase 5 removes them):
  - `CoreTable` in `packages/common/constructs/src/core/dynamodb.ts`;
  - `MediaBucket` in `core/media-bucket.ts`;
  - `UploadBucket` in `core/upload-bucket.ts`;
  - `PublicBucket` in `core/public-bucket.ts`;
  - `OpenSearchCollection` in `core/opensearch.ts`;
  - `VideoTranscodePipeline` in `app/media-convert/video-transcode-pipeline.ts`.

  Each construct's test asserts that a function bound to it gets the variable named in data-model.md with the published fields.
- [ ] T004 Tests first, then add `functionsMissingSettings(template)` to `packages/infra/src/stacks/stack-test-fixture.ts`, beside `tableFunctionsMissingAppConfig`, which stays until Phase 2. It returns the logical IDs of every `AWS::Lambda::Function` whose role's policies grant a `dynamodb:` action on the core table without `DISCAVA_DYNAMODB_CORE_TABLE` in `Environment.Variables`, or `aoss:APIAccessAll` without `DISCAVA_OPENSEARCH_SEARCH`. Unit-test it against a hand-built template with one function of each kind, with and without the variable. Don't assert it in the stack tests yet.

---

## Phase 2: User Story 1 - The table and search come from deploy-time settings (P1) 🎯 MVP

**Goal**: Every function reads the core table name and the search endpoint from its environment. These are the two settings read on almost every cold start, so this phase removes most of the cost on its own.

**Independent test**:
- `pnpm nx run-many --target test --projects @discava/core-table,@discava/search,@discava/common-constructs,@discava/infra -- --run` passes;
- every stack test asserts `functionsMissingSettings(template)` is `[]`;
- `grep -rn "getAppConfig" packages/databases --include=*.ts` finds nothing outside tests;
- `pnpm build` passes.

- [ ] T005 [P] [US1] Tests first, then change `resolveTableName` in `packages/databases/core-table/src/client.ts` to read `process.env.DISCAVA_DYNAMODB_CORE_TABLE` and parse `{ tableName }`.
  - When the variable is absent, throw `Missing deploy-time setting DISCAVA_DYNAMODB_CORE_TABLE`. When it has no `tableName`, throw `Could not resolve table name from DISCAVA_DYNAMODB_CORE_TABLE`.
  - Keep the `LOCAL_DEV === 'true'` branch first.
  - Remove the `@aws-lambda-powertools/parameters/appconfig` import, and drop the dependency from `package.json` if nothing else uses it.
  - Cover the present, absent, missing-field and local cases in `client.test.ts`, creating it if absent.
- [ ] T006 [P] [US1] Tests first, then change `resolveEndpoint` in `packages/databases/search/src/client.ts` to read `DISCAVA_OPENSEARCH_SEARCH` (`{ endpoint }`) only.
  - Remove the `OPENSEARCH_ENDPOINT` path and the AppConfig path, update the comment above it, and keep the `LOCAL_DEV` branch.
  - In `client.test.ts`, replace the `RUNTIME_CONFIG_APP_ID` and `OPENSEARCH_ENDPOINT` stubs with the new variable. This is a named test change: the variable the endpoint comes from changes.
  - Drop the Powertools and `client-appconfigdata` dependencies if unused.
- [ ] T007 [US1] In `packages/common/constructs/src/core/opensearch.ts`, give the index-sync function `bindSettings` in place of its `OPENSEARCH_ENDPOINT` environment. Update `opensearch.test.ts` to expect `DISCAVA_OPENSEARCH_SEARCH`. This is a named test change.
- [ ] T008 [US1] Call `coreTable.bindSettings(fn)` and, where the function uses search, `searchCollection.bindSettings(fn)` next to the existing grant, wherever a function is granted on the table or the collection:
  - `packages/common/constructs/src/app/apis/core-api.ts`, `instructor-api.ts`, `admin-api.ts` and `stripe-webhook-api.ts`: each handler;
  - `packages/infra/src/stacks/data-stack.ts`: the pre-token trigger;
  - `core-api-stack.ts`: reindex and notification unsubscribe;
  - `media-pipeline-stack.ts`: its three handlers;
  - `stream-router-stack.ts`: each handler, in place of the table part of `grantAppConfig`;
  - `payouts-stack.ts` and `payments-stack.ts`: their functions, if they use the table.

  Where a function now reads nothing else from AppConfig, remove its `RUNTIME_CONFIG_APP_ID` and `grantReadAppConfig`. The functions that also read `s3`, `mediaConvert`, `certificates` or `captionTranslation`, and the page renderer, keep them until Phase 3 or 4.
- [ ] T009 [US1] In every stack test that calls `tableFunctionsMissingAppConfig`, replace it with `expect(functionsMissingSettings(template)).toEqual([])`, and delete `tableFunctionsMissingAppConfig` from `stack-test-fixture.ts`. This is a named test change: the safety net moves from "can read AppConfig" to "has the setting".
- [ ] T010 [US1] Update the tests that assert `RUNTIME_CONFIG_APP_ID` on functions this phase switched. Each now asserts `DISCAVA_DYNAMODB_CORE_TABLE` (and `DISCAVA_OPENSEARCH_SEARCH` where relevant), and, for a function with nothing left to read from AppConfig, the absence of `RUNTIME_CONFIG_APP_ID` and of `appconfig:` actions. This is a named test change. The files:
  - `packages/common/constructs/src/app/apis/stripe-webhook-api.test.ts`;
  - `packages/infra/src/stacks/data-stack.test.ts` (the pre-token trigger);
  - `packages/infra/src/stages/application-stage.test.ts`;
  - `packages/events/src/notifications/notification-unsubscribe.test.ts`.
- [ ] T011 [US1] Synthesise (`pnpm nx run @discava/infra:synth`) and confirm no stack-dependency cycle and no change to the deploy order in `application-stage.ts`'s comment. Fix by moving a call, never by adding a dependency.

---

## Phase 3: User Story 1 - Buckets, media pipeline, schedulers and caption translation come from deploy-time settings (P1)

**Goal**: Every remaining runtime reader except the page renderer reads its environment. After this phase only the page renderer has `RUNTIME_CONFIG_APP_ID`.

**Independent test**:
- `pnpm nx run-many --target test --projects @discava/common-server-utils,@discava/instructor-api,@discava/core-api,@discava/events,@discava/common-constructs,@discava/infra -- --run` passes;
- `grep -rnE "getAppConfig|resolveAppConfigValue|RUNTIME_CONFIG_APP_ID" packages --include=*.ts --exclude-dir=node_modules` finds only the page renderer's lines (`handler.ts`, `student-portal.ts`, `data-stack.ts`'s role grant) and tests that assert absence;
- `pnpm build` passes.

- [ ] T012 [P] [US1] Tests first, in `packages/common/server-utils/src/`:
  - `lesson-media-bucket.ts`: `resolveBucketName(key)` returns `readSetting<{ bucketName: string }>('s3', key).bucketName`, keeping its local branch. Delete `resolveAppConfigValue`.
  - `lesson-media.ts`: the CloudFront config is `readSetting('s3', 'LessonMediaBucket')`, with the same field checks and messages.
  - `cleanup-scheduler.ts`: `readSetting('mediaConvert', 'TranscodeCleanup')`.
  - `caption-translation-settings.ts`: `readOptionalSetting('captionTranslation', 'Settings')`. When absent, or when the JSON is invalid, return `OFF` exactly as today. The clamp to `0..MAX_CAPTION_LANGUAGES` is unchanged.
- [ ] T013 [US1] Update those modules' tests: `lesson-media-bucket.test.ts`, `lesson-media.test.ts`, `cleanup-scheduler.test.ts` and `caption-translation-settings.test.ts`. They stub the `DISCAVA_*` variables instead of mocking `@aws-lambda-powertools/parameters/appconfig`, with the same fixture objects. Tests asserting `RUNTIME_CONFIG_APP_ID environment variable is not set` assert `Missing deploy-time setting DISCAVA_…` instead. This is a named test change.
- [ ] T014 [P] [US1] Tests first, then switch the remaining readers:
  - `packages/apis/instructor-api/src/helpers/mediaconvert-client.ts`: `readSetting('mediaConvert', 'VideoTranscodePipeline')`. Update `mediaconvert-client.test.ts`'s line asserting the `RUNTIME_CONFIG_APP_ID` error; this is a named test change.
  - `packages/events/src/media/transcribe-client.ts`: `readOptionalSetting<string>('mediaConvert', 'CaptionLanguageCode') ?? DEFAULT_CAPTION_LANGUAGE`.
  - `packages/events/src/certificates/reminder-schedule.ts`: `readSetting('certificates', 'Reminder')`.

  Each keeps its local branch and gets present and absent tests.
- [ ] T015 [US1] Give each function the settings its code reads, next to its grants, with `bindSettings` for the bucket and pipeline constructs and `addSetting` for the stack-level objects. Then remove `RUNTIME_CONFIG_APP_ID` and `grantReadAppConfig` from every function but the page renderer.
  - `packages/infra/src/stacks/media-pipeline-stack.ts`: `mediaConvert.TranscodeCleanup` (`{ lambdaArn, schedulerRoleArn, scheduleGroupName }`) on every function that calls `cleanup-scheduler`. That includes instructor-api's and core-api's handlers, passed through their stack props as the pipeline's other values are.
  - `packages/infra/src/stacks/stream-router-stack.ts`: `certificates.Reminder` on progress recalculation; `captionTranslation.Settings` on the caption translation handler. Delete `grantAppConfig`.
  - The stack holding instructor-api: `captionTranslation.Settings` on its handler, from the stage's `captionTranslation` config with the same defaults as `stream-router-stack.ts` (`enabled ?? true`, `maxLanguagesPerCourse ?? 9`). Move those defaults into one exported helper both stacks call.
  - The bucket settings (`DISCAVA_S3_LESSON_MEDIA_BUCKET`, `DISCAVA_S3_LESSON_MEDIA_UPLOAD_BUCKET`, `DISCAVA_S3_PUBLIC_MEDIA_BUCKET`) and `DISCAVA_MEDIA_CONVERT_VIDEO_TRANSCODE_PIPELINE` on each function whose code calls the matching reader. Find them by following each reader's importers (`resolveLessonMediaBucketName`, `resolveBucketName`, `lesson-media`, `mediaconvert-client`).

  Keep every `RuntimeConfig.set` call, which Phase 5 removes.
- [ ] T016 [US1] Tests first: in each stack test (`core-api-stack.test.ts`, `instructor-api-stack.test.ts`, `admin-api-stack.test.ts`, `media-pipeline-stack.test.ts`, `stream-router-stack.test.ts`, `payments-stack.test.ts`, `data-stack.test.ts`), add a table of function logical-ID prefix → required `DISCAVA_*` names, built from T015's list, and assert every function in it has them.
  - Assert that no function in these stacks has `RUNTIME_CONFIG_APP_ID` or an `appconfig:` action.
  - Update any existing assertion on those, and on `grantAppConfig`'s output, to match. This is a named test change.
- [ ] T017 [US1] Remove `@aws-lambda-powertools/parameters` and `@aws-sdk/client-appconfigdata` from the `package.json` of every package that no longer imports them (`common-server-utils`, `instructor-api`, `events`, and any other the grep finds), keeping `core-api`'s until Phase 4. Run `pnpm i`. In `notification-unsubscribe.test.ts` and any other test that throws the old `RUNTIME_CONFIG_APP_ID` error from a mock, use the new message; this is a named test change.
- [ ] T018 [US1] Check the scheduler targets for self-references (research R-6): synthesise and confirm no function's environment references its own ARN. If one does, build that ARN from a fixed function name instead and note it in the PR.

---

## Phase 4: User Story 1 - The page renderer reads one free parameter, and operator scripts use the table setting (P1)

**Goal**: The last runtime reader leaves AppConfig, and `seed-categories` and `rebuild-analytics` target a stage without it (US5). After this phase nothing reads AppConfig. It still exists until Phase 5.

**Independent test**:
- `pnpm nx run-many --target test --projects @discava/core-api,@discava/common-constructs,@discava/infra,@discava/tooling-deploy -- --run` passes;
- `grep -rnE "getAppConfig|resolveAppConfigValue|RUNTIME_CONFIG_APP_ID|grantReadAppConfig\(" packages --include=*.ts --exclude-dir=node_modules` finds only `runtime-config.ts`'s definitions and tests asserting absence;
- `pnpm build` passes.

- [ ] T019 [P] [US1] Tests first, then in `scripts/setup-stage.sh`:
  - Add the execution-role statement `StageSettingsParameters`: `ssm:PutParameter`, `ssm:DeleteParameter`, `ssm:GetParameters`, `ssm:AddTagsToResource`, `ssm:RemoveTagsFromResource`, `ssm:ListTagsForResource` on `arn:$AWS_PARTITION:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/$TARGET_STAGE/*`.
  - In the permissions boundary, add a statement `StageSettingsParameterRead` with `ssm:GetParameter` on the same ARN.

  In `packages/tooling/deploy/src/setup-stage.test.ts`, assert both, and that neither names another stage's path or a wildcard parameter.
- [ ] T020 [US1] Tests first, then add `pageRendererParameterName(scope)` to `packages/common/constructs/src/core/settings.ts`, returning `/${Stage.of(scope)!.stageName}/page-renderer`.
  - In `packages/common/constructs/src/app/static-websites/student-portal.ts`, rename `pageRenderer.runtimeConfigAppName` to `settingsParameterName`, and set `PAGE_RENDERER_PARAMETER` on the renderer in place of `RUNTIME_CONFIG_APP_ID`.
  - In `packages/infra/src/stacks/websites-stack.ts`, pass `pageRendererParameterName(this)` in place of `runtimeConfigApplicationName(...)`.
  - Update `student-portal.test.ts` and `websites-stack.test.ts`; this is a named test change.
- [ ] T021 [US1] Tests first, then in `packages/infra/src/stacks/data-stack.ts`:
  - Create `new StringParameter(this, 'PageRendererSettings', { parameterName: pageRendererParameterName(this), stringValue })`. `stringValue` is `this.toJsonString({ tableName: coreTable.table.tableName, publicMediaBaseUrl })`, where `publicMediaBaseUrl` is `https://<cloudFrontDomainName>/`, the same value `PublicBucket` puts in `connection.media.PublicMediaBucket`. Expose it from `PublicBucket` as a property if needed.
  - In `grantPageRendererRead`, replace `grantReadAppConfig(role)` with `parameter.grantRead(role)`.
  - Add `new CfnOutput(this, 'CoreTableName', { value: coreTable.table.tableName })`.
  - In `data-stack.test.ts`, assert the parameter's name and value shape, the renderer role's `ssm:GetParameter` on its ARN only, no `appconfig:` action on that role, and the output.
- [ ] T022 [US1] Tests first, then add `packages/apis/core-api/src/page-renderer/helpers/page-renderer-settings.ts` with `resolvePageRendererSettings()`, following [contracts/settings-readers.md](./contracts/settings-readers.md):
  - one `GetParameter` per instance, with concurrent callers sharing one promise;
  - a failed read is forgotten so the next call retries;
  - throws naming `PAGE_RENDERER_PARAMETER` when unset, and naming the missing field when the JSON lacks `tableName` or `publicMediaBaseUrl`.

  Add `@aws-sdk/client-ssm` to `core-api` via the workspace catalog. Unit-test with a fake client.
- [ ] T023 [US1] In `packages/apis/core-api/src/page-renderer/handler.ts`, outside local dev, `await resolvePageRendererSettings()` before the first table read.
  - Set `process.env.DISCAVA_DYNAMODB_CORE_TABLE = JSON.stringify({ tableName })` so `@discava/core-table` resolves as elsewhere.
  - Make `readMediaBaseUrl` return `publicMediaBaseUrl`.
  - A failure takes the existing 503 path.
  - Remove the `resolveAppConfigValue` import, and drop `core-api`'s Powertools parameters and `client-appconfigdata` dependencies if unused.
  - Extend the renderer's tests: a cold request reads the parameter once, and a parameter failure gives the 503 response.
- [ ] T024 [P] [US5] Tests first, then in `packages/tooling/deploy/src/seed-categories/seed.ts` and `analytics/rebuild-analytics.ts`, set `LOCAL_DEV=true` only when `DISCAVA_DYNAMODB_CORE_TABLE` is unset, replacing the `RUNTIME_CONFIG_APP_ID` check, and update their header comments.
  - Update `packages/tooling/deploy/README.md`, `packages/tooling/deploy/CLAUDE.md` and `docs/src/content/docs/en/deploy/first-deploy.mdx`'s seeding step to the command in [contracts/settings-readers.md](./contracts/settings-readers.md) (the `CoreTableName` output of `<stage>-Data`).
  - Update `CONTRIBUTING.md`'s `rebuild-analytics` note if it names the old variable.
- [ ] T025 [US1] (human, before merge) Re-run `scripts/setup-stage.sh discava-development` with admin credentials (and for any other deployed stage), so the deploy this PR triggers can create `/discava-development/page-renderer` ([contracts/rollout.md](./contracts/rollout.md) step 1).
- [ ] T026 [US1] (human) After this PR deploys, open a public course page and `/sitemap.xml` on `discava-development` signed out. Check the renderer's logs show one parameter read per cold start and no error. Then run `seed-categories` with the documented command ([quickstart.md](./quickstart.md) step 7, last two rows), and confirm `rollout.md` step 3: no function has `RUNTIME_CONFIG_APP_ID`.

---

## Phase 5: User Story 3 - Remove AppConfig and keep the final stack only for portal configuration (P2)

**Goal**: The stage carries no AppConfig resources or permissions. The `RuntimeConfig` stack becomes `PortalConfig`, holding only each portal's `runtime-config.json` deployment with unchanged content. Existing stages upgrade by the documented steps (US4).

**Independent test**:
- `pnpm nx run-many --target test --projects @discava/common-constructs,@discava/infra,@discava/tooling-deploy -- --run` passes;
- no template has `AWS::AppConfig::*` or an `appconfig:` action;
- `grep -rn "aws-appconfig\|appconfig" packages scripts --include=*.ts --include=*.sh --exclude-dir=node_modules` finds only the tests asserting absence;
- `pnpm build` passes.

- [ ] T027 [US3] Tests first, then in `packages/infra/src/stages/application-stage.test.ts`, before changing the code, snapshot each portal's `runtime-config.json` source (the `Source.data` content of its `BucketDeployment`) as synthesised from `main`. Then add these assertions:
  - no stack contains an `AWS::AppConfig::*` resource;
  - no IAM statement in any stack has an `appconfig:` action;
  - no function's serialised `Environment.Variables` exceeds 4,096 bytes;
  - the stage has a stack with id `PortalConfig` that depends on every other application stack, and none with id `RuntimeConfig`;
  - each portal's `runtime-config.json` source equals the snapshot.
- [ ] T028 [US3] In `packages/common/constructs/src/core/runtime-config.ts`:
  - Delete `placeIn`, `appConfigApplicationId`, `grantReadAppConfig`, `ensureAspect` and its aspect, `runtimeConfigApplicationName`, `RuntimeConfigPlacement`, and every `aws-appconfig` import.
  - Keep `ensure`, `of`, `set` and `get` for `connection`. Make `set` throw for any other namespace, so no one adds a runtime-config namespace by habit, and test it in `runtime-config.test.ts`.
  - Update the class comment to say it holds the portals' `connection` settings only.
- [ ] T029 [US3] Delete every `RuntimeConfig.set` call for `dynamodb`, `s3`, `opensearch`, `mediaConvert`, `certificates` and `captionTranslation`. That covers `dynamodb.ts`, `media-bucket.ts`, `upload-bucket.ts`, `public-bucket.ts` (keep its `connection.media` call), `opensearch.ts`, `video-transcode-pipeline.ts`, `media-pipeline-stack.ts` and `stream-router-stack.ts`. Update the constructs' tests that asserted those namespaces; this is a named test change, since the values now live in `bindSettings`, tested in T003.
- [ ] T030 [US3] In `packages/infra/src/stages/application-stage.ts`:
  - Create the last stack as `new Stack(this, 'PortalConfig', stackProps)`, and rename `runtimeConfigScope` to `portalConfigScope` through `websites-stack.ts`, `static-website.ts` and the portal constructs.
  - Delete `RuntimeConfig.ensure(data).placeIn(...)` and its comment.
  - Update the class comment's deploy order (`… -> AdminApi -> PortalConfig`) and the paragraph describing `RuntimeConfig`.
- [ ] T031 [US3] Confirm the portal `BucketDeployment`s in `packages/common/constructs/src/core/static-website.ts` keep CDK's default `retainOnDelete: true`, so deleting the old stack leaves each `runtime-config.json` in place (research R-8). If the code sets it, set `retainOnDelete: true` explicitly, and add a construct test asserting `RetainOnDelete` is true.
- [ ] T032 [P] [US3] Tests first, then in `scripts/setup-stage.sh`, delete the execution role's `AppConfigForDiscava` statement and the two `appconfig:` actions from the boundary's `ResourcesNamedById`. In `setup-stage.test.ts`, assert neither policy has any `appconfig:` action. Update the comment block that lists "MediaConvert and AppConfig".
- [ ] T033 [P] [US3] Remove `@aws-lambda-powertools/parameters` and `@aws-sdk/client-appconfigdata` from every remaining `package.json`, and their entries from `pnpm-workspace.yaml`'s catalog if nothing uses them. Run `pnpm i`. Remove `aws-appconfig` from any `common-constructs` import list.
- [ ] T034 [US4] Write the upgrade steps into the PR description, copied from [contracts/rollout.md](./contracts/rollout.md) steps 3 to 6 with the real stack names (`discava-development-RuntimeConfig`, `discava-development-Data`), and the two failure messages and what to do about them.
- [ ] T035 [US4] (human, before merge) Do [contracts/rollout.md](./contracts/rollout.md) step 3, confirming nothing on `discava-development` reads AppConfig. Then do step 4: `aws cloudformation delete-stack --stack-name discava-development-RuntimeConfig` and `aws cloudformation wait stack-delete-complete --stack-name discava-development-RuntimeConfig`. Check each portal still loads its `runtime-config.json`, then merge.
- [ ] T036 [US4] (human) After the deploy: `aws appconfig list-applications` lists no Discava application, `discava-development-PortalConfig` exists, each portal signs in, and each portal's `runtime-config.json` has the same content as before. Then optionally re-run `scripts/setup-stage.sh discava-development` to drop the AppConfig rights (rollout step 6).

---

## Phase 6: Polish - docs, deployed checks and owner confirmation

- [ ] T037 [P] Update the docs that describe AppConfig to describe deploy-time settings. Note translations as pending in the PR if the docs have translated copies.
  - `docs/src/content/docs/en/architecture/aws.mdx`: the stack table's `RuntimeConfig` row becomes `PortalConfig`; the services table's "Configuration | AppConfig" row; the "Backend functions read … from AppConfig" bullet.
  - `architecture/security.mdx`: "Functions read resource names from AppConfig".
  - `design/public-pages.mdx`: the 503 cases, and the renderer's settings parameter.
  - `design/stream-event-router.mdx`: step 4's `grantAppConfig`.
- [ ] T038 [P] Update `packages/infra/CLAUDE.md`, `packages/common/constructs/CLAUDE.md` and `packages/apis/CLAUDE.md` where they mention `RuntimeConfig`, AppConfig or `RUNTIME_CONFIG_APP_ID`. Add a short "How a function gets a setting" note to `packages/common/constructs/CLAUDE.md`: call the resource's `bindSettings(fn)` next to its grant, or `addSetting` for a stack-level value; read it with `readSetting`; never fetch settings at runtime. Add a matching line to `CONTRIBUTING.md` where backend Lambdas are described.
- [ ] T039 (human) After Phase 5 is deployed, walk every flow in [quickstart.md](./quickstart.md) step 7 on `discava-development`, checking each function's logs for `deploy-time setting` or `AccessDenied` errors. Then compare cold starts as in step 9 (SC-005).
- [ ] T040 (human) The day after Phase 5 is deployed and used, run [quickstart.md](./quickstart.md) step 10 and record in the PR that AppConfig usage is zero from the deploy date (SC-001). Also check whether credits were what kept October and November at $0 (research R-1), and note it.
- [ ] T041 (human) The owner confirms the defaults this spec took without asking (spec, Clarifications):
  - the page renderer reads one Systems Manager parameter;
  - the final stack is kept and renamed `PortalConfig`;
  - the rollout is switch PRs, then deleting the old stack by hand, then the removal PR;
  - operator scripts take `DISCAVA_DYNAMODB_CORE_TABLE` from the `CoreTableName` output;
  - only the caption language and caption translation settings keep silent defaults.

---

## Dependencies

- **Phase order**: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6. Phases 2, 3 and 4 each leave every not-yet-switched function on AppConfig, which still exists, so each deploys on its own.
- **Phase 4**: needs T025 (re-running `setup-stage.sh`) done on every deployed stage before it is merged, or its deploy fails and rolls back.
- **Phase 5**: needs Phases 2 to 4 deployed on every stage, and T035 (deleting the old stack) done just before merge. Without it, the deploy fails in Data ("Export … in use") and rolls back.
- **Phase 6**: T037 and T038 can be written alongside Phase 5. T039 and T040 need Phase 5 deployed.
- **Within Phase 1**: T001 and T002 in parallel, then T003, then T004.
- **Within Phase 2**: T005 and T006 in parallel, then T007, T008, T009, T010, T011.
- **Within Phase 3**: T012 and T014 in parallel, then T013, T015, T016, T017, T018.
- **Within Phase 4**: T019 any time, T020 → T021 → T022 → T023, and T024 in parallel. T025 before merge, T026 after deploy.
- **Within a phase**: tests come first, and tasks run in ID order except those marked [P].

## Parallel examples

```text
Phase 1:  T001 (settings module)  ║  T002 (addSetting)
Phase 2:  T005 (core-table reader)  ║  T006 (search reader)
Phase 3:  T012 (server-utils readers)  ║  T014 (instructor-api and events readers)
Phase 4:  T019 (setup-stage.sh)  ║  T024 (operator scripts)  ║  T020-T023 (page renderer)
Phase 5:  T032 (setup-stage.sh)  ║  T033 (dependencies)
Phase 6:  T037 (docs)  ║  T038 (CLAUDE.md files)
```

## Implementation strategy

- **MVP**: Phases 1 and 2, two PRs. The table name and search endpoint are by far the most-read settings (every function that touches the table reads `dynamodb` on its first request), so most of the per-cold-start fetches stop here.
- **Then**: Phases 3 and 4 move every other reader off AppConfig, after which the stage makes no AppConfig call at all (SC-001, SC-002). This can be confirmed on the bill before anything is removed.
- **Finally**: Phase 5 removes the unused resources and permissions with one manual step per stage, and Phase 6 updates the docs and runs the deployed checks.
