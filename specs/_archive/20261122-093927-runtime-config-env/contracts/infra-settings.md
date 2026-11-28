# Contract: Settings in the Infrastructure

This contract covers how the CDK app gives each function its settings, how the page renderer parameter is created, how the stack tests check them, and the `PortalConfig` stack.

## Construct helpers

```ts
// common-constructs/src/core/settings.ts (new)
/** fn.addEnvironment(settingEnvName(ns, key), Stack.of(fn).toJsonString(value)) */
export const addSetting: (fn: IFunction & { addEnvironment(k: string, v: string): unknown },
                          namespace: string, key: string, value: object | string) => void;
```

- `Stack.of(fn).toJsonString` resolves tokens in the *consumer's* stack. A value from another stack therefore becomes an export in the producer and an import in the consumer, as a grant's ARN does today.
- Each resource construct gains `bindSettings(fn)`, which calls `addSetting` with exactly the object it passes to `RuntimeConfig.set` today:
  - `CoreTable` → `dynamodb`/`<runtimeConfigKey>`
  - `MediaBucket` (lesson media) → `s3`/`<runtimeConfigKey>`
  - `UploadBucket` → `s3`/`<runtimeConfigKey>`
  - `PublicBucket` → `s3`/`<runtimeConfigKey>`
  - `OpenSearchCollection` → `opensearch`/`<runtimeConfigKey>`; its index-sync function uses it too, in place of `OPENSEARCH_ENDPOINT`
  - `VideoTranscodePipeline` → `mediaConvert`/`VideoTranscodePipeline`
- In the switch PRs, the constructs keep calling `RuntimeConfig.set` for these namespaces, so the AppConfig content and its exports stay valid. The removal PR deletes those calls.

## Where the calls go

Every place that today has `addEnvironment('RUNTIME_CONFIG_APP_ID', …)` plus `grantReadAppConfig(fn)` instead calls `bindSettings(fn)` for each resource that function's code reads by name, next to the grant on that resource. When a function no longer reads anything from AppConfig, its `RUNTIME_CONFIG_APP_ID` and `grantReadAppConfig` are removed in the same PR.

| Location | Functions |
|---|---|
| `app/apis/core-api.ts`, `instructor-api.ts`, `admin-api.ts` | each tRPC handler: core table, plus the buckets, search, pipeline and cleanup it reads |
| `app/apis/stripe-webhook-api.ts` | webhook: core table |
| `infra/stacks/data-stack.ts` | pre-token trigger: core table |
| `infra/stacks/core-api-stack.ts` | reindex: table and search; notification unsubscribe: table |
| `infra/stacks/media-pipeline-stack.ts` | transcode outcome, transcribe complete, transcode cleanup: table, buckets, cleanup |
| `infra/stacks/stream-router-stack.ts` | every feature handler through `grantAppConfig`, which is replaced by a per-handler list of `bindSettings` and `addSetting` calls; progress recalculation also gets `certificates.Reminder`; caption translation also gets `captionTranslation.Settings` |
| stacks holding instructor-api | `captionTranslation.Settings`, from the stage's `captionTranslation` config, with the same defaults as `stream-router-stack.ts` today |

## Page renderer parameter

- **Naming helper**: `common-constructs` exports `pageRendererParameterName(scope) => \`/${Stage.of(scope)!.stageName}/page-renderer\``.
- **Websites**: `student-portal.ts` sets `PAGE_RENDERER_PARAMETER` on the renderer, replacing `RUNTIME_CONFIG_APP_ID: runtimeConfigAppName`. `StudentPortalProps.pageRenderer.runtimeConfigAppName` becomes `settingsParameterName`.
- **Data**: it creates `new StringParameter(this, 'PageRendererSettings', { parameterName, stringValue: toJsonString({ tableName, publicMediaBaseUrl }) })`. In `grantPageRendererRead` it calls `parameter.grantRead(role)` on the mutable role import, in place of `grantReadAppConfig(role)`.
- **`scripts/setup-stage.sh`**:
  - The execution role gains the statement `StageSettingsParameters`: `ssm:PutParameter`, `ssm:DeleteParameter`, `ssm:GetParameters`, `ssm:AddTagsToResource`, `ssm:RemoveTagsFromResource`, `ssm:ListTagsForResource` on `arn:…:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/$TARGET_STAGE/*`.
  - The permissions boundary gains `ssm:GetParameter` on the same ARN.
  - `setup-stage.test.ts` asserts both, and that neither reaches another stage's path.

## Stack tests

- **`stack-test-fixture.ts`**: `tableFunctionsMissingAppConfig` is replaced by `functionsMissingSettings(template)`. It lists every `AWS::Lambda::Function` whose role's policies grant `dynamodb:*` on the core table without `DISCAVA_DYNAMODB_CORE_TABLE`, or `aoss:APIAccessAll` without `DISCAVA_OPENSEARCH_SEARCH`. Every stack test that uses the old helper uses the new one and expects `[]`.
- **Per-function expectations**: each stack test keeps a table of function (by logical-ID prefix) → the `DISCAVA_*` names it must have. These cover the buckets, MediaConvert, cleanup, reminder and caption translation, and the test fails on a missing name. Tests that match `RUNTIME_CONFIG_APP_ID: Match.anyValue()` match the specific `DISCAVA_*` names instead:
  - `stripe-webhook-api.test.ts`
  - `data-stack.test.ts`
  - `application-stage.test.ts`
- **Stage test** (`application-stage.test.ts`):
  - after the removal PR: no `AWS::AppConfig::*` resource in any stack, and no IAM statement with an `appconfig:` action;
  - always: no function's `Environment.Variables` larger than 4 KB when serialised;
  - each portal's `runtime-config.json` source equals its snapshot from before the change;
  - no stack named `RuntimeConfig`, and a stack named `PortalConfig` that depends on every other application stack.

## `PortalConfig` (removal PR)

- **Stack**: `application-stage.ts` creates `new Stack(this, 'PortalConfig', stackProps)` in place of `'RuntimeConfig'`, passed as `runtimeConfigScope` (renamed `portalConfigScope`). `RuntimeConfig.ensure(data).placeIn(...)` is deleted.
- **`RuntimeConfig` class**: it keeps only `set`, `get`, `ensure` and `of` for the `connection` namespace. Deleted:
  - `placeIn`, `appConfigApplicationId`, `grantReadAppConfig`, `ensureAspect`;
  - `runtimeConfigApplicationName` and `RuntimeConfigPlacement`;
  - every `aws-appconfig` import.
- **Other `set` calls**: `set` calls for the `dynamodb`, `s3`, `opensearch`, `mediaConvert`, `certificates` and `captionTranslation` namespaces are deleted. A unit test asserts that `RuntimeConfig.set` with any namespace but `connection` throws, so no one adds a runtime-config namespace by habit.
- **`scripts/setup-stage.sh`**: drops `AppConfigForDiscava` from the execution role, and drops `appconfig:GetLatestConfiguration` and `appconfig:StartConfigurationSession` from the boundary's `ResourcesNamedById`. `setup-stage.test.ts` asserts neither has any `appconfig:` action.
- **Dependencies**: `@aws-lambda-powertools/parameters` and `@aws-sdk/client-appconfigdata` are removed from every `package.json` that no longer imports them. `pnpm-workspace.yaml`'s catalog entries are removed if nothing uses them.
