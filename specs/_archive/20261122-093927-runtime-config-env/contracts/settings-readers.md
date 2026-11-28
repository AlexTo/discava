# Contract: Settings Readers (runtime)

This contract covers how backend code reads its deploy-time settings. The variable names and value shapes are in [data-model.md](../data-model.md).

## `@discava/common-server-utils/settings` (new public module)

```ts
/** `('s3', 'LessonMediaBucket')` → `'DISCAVA_S3_LESSON_MEDIA_BUCKET'`. Pure; shared with the constructs. */
export const settingEnvName: (namespace: string, key: string) => string;

/** Parses the setting's JSON. Throws `Missing deploy-time setting <NAME>` when unset or empty,
 *  `Invalid deploy-time setting <NAME>` when not a JSON object or string. */
export const readSetting: <T>(namespace: string, key: string) => T;

/** As readSetting, but returns undefined when the variable is unset or empty. */
export const readOptionalSetting: <T>(namespace: string, key: string) => T | undefined;
```

- These are synchronous. Callers that are `async` today keep their `async` signatures, so their callers don't change.
- An error message names the variable but never includes its value.
- Nothing calls AppConfig, and the module imports no AWS SDK.

## Readers and their behaviour after the switch

| Reader | Today | After |
|---|---|---|
| `core-table` `resolveTableName()` | AppConfig `dynamodb.CoreTable.tableName`, cached | `JSON.parse(process.env.DISCAVA_DYNAMODB_CORE_TABLE).tableName`. Throws naming the variable when unset. `LOCAL_DEV=true` still wins |
| `search` `resolveEndpoint()` | `OPENSEARCH_ENDPOINT`, else AppConfig `opensearch.Search.endpoint` | `DISCAVA_OPENSEARCH_SEARCH.endpoint` only. `OPENSEARCH_ENDPOINT` is gone. `LOCAL_DEV=true` still wins |
| `lesson-media-bucket` `resolveBucketName(key)` | AppConfig `s3.<key>.bucketName` via `resolveAppConfigValue` | `readSetting('s3', key).bucketName`. `resolveAppConfigValue` is deleted |
| `lesson-media` CloudFront config | AppConfig `s3.LessonMediaBucket` | `readSetting('s3', 'LessonMediaBucket')`, with the same field checks and messages |
| `cleanup-scheduler` | `mediaConvert.TranscodeCleanup` | `readSetting('mediaConvert', 'TranscodeCleanup')` |
| `caption-translation-settings` | `captionTranslation.Settings`, off on any error | `readOptionalSetting`. Absent means off (`{ enabled: false, maxLanguagesPerCourse: 0 }`). The clamp to 0..9 is unchanged. Invalid JSON is still caught and treated as off, as today |
| `instructor-api` `mediaconvert-client` | `mediaConvert.VideoTranscodePipeline` | `readSetting('mediaConvert', 'VideoTranscodePipeline')` |
| `events` `transcribe-client` caption language | `mediaConvert.CaptionLanguageCode`, default on error | `readOptionalSetting`, default when absent |
| `events` `reminder-schedule` | `certificates.Reminder` | `readSetting('certificates', 'Reminder')` |
| `core-api` page renderer media base URL and table | AppConfig by application *name* | `helpers/page-renderer-settings.ts` (below) |

The local-development branches (`isLocalDev()` / `LOCAL_DEV === 'true'`) are untouched in every reader.

## Page renderer settings (`core-api/src/page-renderer/helpers/page-renderer-settings.ts`, new)

```ts
/** Reads PAGE_RENDERER_PARAMETER's JSON once per instance; later calls reuse the same promise.
 *  A failed read is forgotten, so the next request retries. */
export const resolvePageRendererSettings: () => Promise<{ tableName: string; publicMediaBaseUrl: string }>;
```

- **Behaviour**:
  - The renderer calls this before its first table read. It then sets `process.env.DISCAVA_DYNAMODB_CORE_TABLE` to `{"tableName": …}` so `@discava/core-table` resolves the table as every other function does, and uses `publicMediaBaseUrl` for `mediaBaseUrl`.
  - The 503 path in `design/public-pages.mdx` ("table, AppConfig or `index.html` read fails") now covers "table, settings parameter or `index.html`".
  - Locally, `local-page-renderer.ts` keeps its local values and never calls this.
- **Unit tests** (with a fake SSM client):
  - parses the parameter;
  - makes one call for several concurrent requests;
  - retries after a failure;
  - throws naming `PAGE_RENDERER_PARAMETER` when it is unset;
  - throws when the parameter's JSON lacks a field.

## Operator scripts

- **`seed-categories` and `rebuild-analytics`**: they treat the run as local (`LOCAL_DEV=true`) when `DISCAVA_DYNAMODB_CORE_TABLE` is unset. Otherwise they use that table. This replaces their `RUNTIME_CONFIG_APP_ID` check.
- **The documented command** (in `first-deploy.mdx` and `packages/tooling/deploy/README.md`):

```sh
TABLE=$(aws cloudformation describe-stacks --stack-name <stage>-Data \
  --query 'Stacks[0].Outputs[?contains(OutputKey, `CoreTableName`)].OutputValue' --output text)
DISCAVA_DYNAMODB_CORE_TABLE="{\"tableName\":\"$TABLE\"}" pnpm nx run @discava/tooling-deploy:seed-categories
```

## Tests each reader keeps or changes

- **Mocks**: tests that mock `@aws-lambda-powertools/parameters/appconfig` switch to `vi.stubEnv` with the JSON value. The fixtures (the object shapes) stay the same.
- **Missing-setting tests**: tests that assert `RUNTIME_CONFIG_APP_ID environment variable is not set` now assert `Missing deploy-time setting DISCAVA_…`. These are the named behaviour change for constitution IV and FR-019:
  - `lesson-media-bucket.test.ts`
  - `lesson-media.test.ts`
  - `mediaconvert-client.test.ts`
  - `notification-unsubscribe.test.ts`
  - `search/client.test.ts`
- **New tests**: each reader gets one test for a present setting, one for an absent required setting, and (for the optional ones) one for the default.
