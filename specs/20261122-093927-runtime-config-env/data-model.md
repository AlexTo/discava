# Data Model: Deploy-Time Settings

This feature has no table, entity or index change. Its "data" is the set of settings each function is deployed with. The objects keep the shapes AppConfig holds today (FR-006). Only where they live changes.

## Settings catalogue

The variable name is `settingEnvName(namespace, key)`. It is `DISCAVA_` followed by the namespace and the key, each split at case changes, upper-cased and joined with `_`. The value is the object below as JSON. Values marked † are CloudFormation tokens resolved at deploy time, and may be cross-stack imports.

| Variable | Namespace / key | Shape | Set by | Read by | Required |
|---|---|---|---|---|---|
| `DISCAVA_DYNAMODB_CORE_TABLE` | `dynamodb` / `CoreTable` | `{ tableName† }` | `CoreTable.bindSettings` | every function using `@discava/core-table` | yes |
| `DISCAVA_OPENSEARCH_SEARCH` | `opensearch` / `Search` | `{ endpoint† }` | `OpenSearchCollection.bindSettings` (also index sync, replacing `OPENSEARCH_ENDPOINT`) | core-api, reindex, search indexing, transcript sync, index sync | yes |
| `DISCAVA_S3_LESSON_MEDIA_BUCKET` | `s3` / `LessonMediaBucket` | `{ bucketName†, cloudFrontDomainName†, cloudFrontKeyPairId†, cloudFrontPrivateKeySecretArn†, cookieDomain? }` | `LessonMediaBucket.bindSettings` | functions that sign lesson media or read or write the bucket by name | yes |
| `DISCAVA_S3_LESSON_MEDIA_UPLOAD_BUCKET` | `s3` / `LessonMediaUploadBucket` | `{ bucketName† }` | `LessonMediaUploadBucket.bindSettings` | instructor-api upload procedures, transcode handlers | yes |
| `DISCAVA_S3_PUBLIC_MEDIA_BUCKET` | `s3` / `PublicMediaBucket` | `{ bucketName†, cloudFrontDomainName† }` | `PublicMediaBucket.bindSettings` | instructor-api (course images, previews) | yes |
| `DISCAVA_MEDIA_CONVERT_VIDEO_TRANSCODE_PIPELINE` | `mediaConvert` / `VideoTranscodePipeline` | `{ roleArn†, jobTemplateArn† }` | `VideoTranscodePipeline.bindSettings` | instructor-api, core-api (where `mediaconvert-client` is used) | yes |
| `DISCAVA_MEDIA_CONVERT_TRANSCODE_CLEANUP` | `mediaConvert` / `TranscodeCleanup` | `{ lambdaArn†, schedulerRoleArn†, scheduleGroupName† }` | `MediaPipelineStack` via `addSetting` | functions that call `cleanup-scheduler` | yes |
| `DISCAVA_MEDIA_CONVERT_CAPTION_LANGUAGE_CODE` | `mediaConvert` / `CaptionLanguageCode` | `"en-US"` style string | nobody today | `transcribe-client` | **no**: defaults to `DEFAULT_CAPTION_LANGUAGE` |
| `DISCAVA_CERTIFICATES_REMINDER` | `certificates` / `Reminder` | `{ lambdaArn†, schedulerRoleArn†, scheduleGroupName† }` | `StreamRouterStack` via `addSetting` | progress recalculation (`reminder-schedule`) | yes |
| `DISCAVA_CAPTION_TRANSLATION_SETTINGS` | `captionTranslation` / `Settings` | `{ enabled: boolean, maxLanguagesPerCourse: number }` | the stacks holding its readers, from the stage config | instructor-api, caption translation handler | **no**: defaults to off |

Exact consumer lists are fixed by the per-function tables in the stack tests (research R-7). "Read by" above names the code paths, not every function.

### Validation rules

- **Required setting absent**: `readSetting` throws `Missing deploy-time setting <VARIABLE>` (FR-003).
- **Value isn't valid JSON or not an object**: `readSetting` throws `Invalid deploy-time setting <VARIABLE>`, without echoing the value.
- **Required field missing from the object**: the reader that uses the field throws, naming the variable and the field, as each does today ("Could not resolve … from runtime config").
- **Optional setting**: `readOptionalSetting` returns `undefined` when the variable is absent and throws on invalid JSON. Its caller applies today's default.
- **Size**: the stage test fails if any function's whole environment exceeds 4 KB, as Lambda does.

## Page renderer parameter

| Field | Value |
|---|---|
| Name | `/<stage>/page-renderer`, where `<stage>` is the CDK stage name (`discava-development`). A helper in `common-constructs` derives it for both the Websites stack (which passes it to the renderer as `PAGE_RENDERER_PARAMETER`) and Data (which writes it) |
| Type | Standard tier, `String` |
| Value | JSON `{ "tableName": "…", "publicMediaBaseUrl": "https://…/" }` |
| Written by | Data stack (`StringParameter`), from `coreTable.table.tableName` and the public media bucket's base URL (the same value `connection.media.PublicMediaBucket` holds) |
| Read by | the page renderer, once per instance, through `GetParameter` |
| Permission | `ssm:GetParameter` on the one parameter ARN, granted by Data on the renderer's role (mutable import, as today) |

## Portal configuration file (unchanged content)

Each portal's `runtime-config.json` keeps the `connection` namespace exactly: `cognitoProps`, `apis`, `portals`, `media` and `site`. Only the stack that deploys it changes, from `RuntimeConfig` to `PortalConfig`. The `RuntimeConfig` construct keeps `set('connection', …)` and `get('connection')` and loses the other namespaces.

## State transitions per stage (rollout)

```text
today ──switch PRs──▶ readers on settings; AppConfig still deployed, unread, no function permitted to read it
      ──operator deletes <stage>/RuntimeConfig──▶ AppConfig content gone; app/env/strategy in Data unimported;
                                                  portals' runtime-config.json retained in their buckets
      ──removal PR deploy──▶ Data deletes the AppConfig app/env/strategy; PortalConfig redeploys runtime-config.json
```
