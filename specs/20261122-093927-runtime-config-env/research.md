# Research: Deploy-Time Settings for Backend Functions

## R-1: Where the cost comes from

- **Decision**: Treat every runtime configuration fetch as the cost to remove, not the request count.
- **Findings**:
  - Cost Explorer files AppConfig under the service "AWS Systems Manager". On `discava-development` (ap-southeast-2) the only Systems Manager usage types are `APS2-AppConfig-Deployments` and `APS2-AppConfig-Requests`.
  - `APS2-AppConfig-Deployments` is AppConfig's "configurations received" meter, priced at $0.0008 each. September's $1.772 is exactly 2,215 × $0.0008. Requests cost $0.0000002 each, so September's 2,221 requests cost $0.0004.
  - Configurations received roughly equalled requests every day (for example 1,089 and 1,092 on 2026-09-21). Each billed request returned a full payload, because a new configuration session's first `GetLatestConfiguration` always does.
  - Volume: 2,215 in September, 13,709 in October and 37,576 from 1 to 22 November 2026. October and November show $0 billed, most likely because credits covered it; this wasn't checked. At list price that would be about $11 and $30.
  - Every reader caches in a module variable, so a warm instance never refetches. The count is therefore driven by cold starts × settings groups read. A function that reads `dynamodb`, `s3` and `opensearch` pays three times per cold start. `lesson-media-bucket.ts` caches per key, not per namespace, so it can fetch `s3` once for each bucket it names.
- **Rationale**: Caching better (per namespace, or the AppConfig Lambda extension's cache) still pays once per instance per namespace. Only removing the runtime fetch makes the cost zero.

## R-2: Environment variables over the alternatives

- **Decision**: Pass each setting to the functions that read it as a Lambda environment variable at synth time.
- **Rationale**:
  - Every value is known when the stage is deployed and changes only on a redeploy. Nothing writes to AppConfig between deploys (the hosted versions are created by CloudFormation).
  - Environment variables are free and need no network call or IAM permission. They are already used for many values: secret ARNs, `WEBSITE_BUCKET`, `SITE_NAME`, and `OPENSEARCH_ENDPOINT` for index sync.
  - CDK turns a reference to a resource in another stack into an export and import. The consuming stacks already depend on the stacks that hold their resources, because they grant on them, so no new stack dependency is added (R-3 covers the exception).
  - Lambda's 4 KB limit on total environment size is far away. The largest setting is the lesson media bucket's (five fields, about 300 bytes as JSON).
- **Alternatives considered**:
  - *AppConfig Lambda extension layer*: caches across invocations of one instance, not across instances, so cold starts still pay. It also adds a layer to every function.
  - *Systems Manager Parameter Store for everything*: standard parameters are free, but every function would still make a network call on cold start and need a read permission. That is only worth it where an environment variable can't be used (R-3).
  - *Per-namespace caching in the existing readers*: cuts the per-start multiplier from up to 4 to 1, but leaves the cost scaling with cold starts.

## R-3: The page renderer's stack-order problem

- **Decision**: The Data stack writes one Systems Manager standard parameter, `/<stage>/page-renderer`, holding `{ "tableName", "publicMediaBaseUrl" }`. The page renderer reads it once per function instance with `GetParameter` and keeps it. Data grants `ssm:GetParameter` on that one parameter to the renderer's role through the existing mutable role import.
- **Findings**:
  - The renderer (`CoreApiPageRenderer`, built in `student-portal.ts`) is in the **Websites** stack, which deploys first, and **Data** depends on Websites for Cognito callback URLs and CORS.
  - It reads the core table name and `s3.PublicMediaBucket.cloudFrontDomainName`, both created in Data. A direct reference would make Websites depend on Data: a cycle.
  - Today it gets around this by being given the AppConfig application's *name* (`runtimeConfigApplicationName`), which is known at synth time. Data grants the renderer's role read access through `Role.fromRoleArn(..., { mutable: true })` (`data-stack.ts`).
  - Standard parameters have no storage charge and no charge for API calls at standard throughput. Higher throughput, which is off by default and not enabled here, costs $0.05 per 10,000 calls.
  - The renderer has reserved concurrency of 20 by default, so cold starts are bounded. The default standard throughput limit (40 `GetParameter` calls per second per account and region) is far above that.
- **Alternatives considered**:
  - *Move the renderer to a stack after Data* (for example CoreApi, since it is core-api's second handler): the student portal's distribution in Websites would then need the function's URL from a later stack. That is a Websites → CoreApi dependency, while CoreApi already depends on Websites: a cycle.
  - *Read `runtime-config.json` from the website bucket*: the renderer already reads the bucket, and the file already has the public media URL under `connection.media`. But it doesn't have the table name, and adding it would publish the table name to every visitor, since the bucket is served whole through CloudFront.
  - *Give the core table a fixed physical name*: renaming a table replaces it, which loses data on existing stages.
  - *Move Cognito and the buckets' CORS setup so Data no longer depends on Websites*: a large restructuring for one function.
- **Consequences**:
  - The stage's deploy execution role needs `ssm:PutParameter`, `ssm:DeleteParameter`, `ssm:GetParameters`, `ssm:AddTagsToResource`, `ssm:RemoveTagsFromResource` and `ssm:ListTagsForResource` on `parameter/<stage>/*`. Today it only has read on `cdk-bootstrap` and `cdk/exports`.
  - The permissions boundary needs `ssm:GetParameter` on the same path.
  - Both are added to `scripts/setup-stage.sh`. An operator re-runs it for each existing stage **before** the PR that adds the parameter is deployed (`deploy.yml` deploys on merge when `AUTO_DEPLOY_STAGE` is set).

## R-4: Naming and shape of the settings

- **Decision**:
  - One environment variable per published object. It is named `DISCAVA_<NAMESPACE>_<KEY>` in upper snake case, and its value is the same object, as JSON, that AppConfig holds today. For example `DISCAVA_DYNAMODB_CORE_TABLE={"tableName":"…"}` and `DISCAVA_S3_LESSON_MEDIA_BUCKET={"bucketName":"…","cloudFrontDomainName":"…",…}`.
  - The name function and a typed reader live in a new public module, `@discava/common-server-utils/settings`. The constructs import the name function from there; `common-constructs` already depends on `common-server-utils`.
- **Rationale**:
  - Keeping each object's shape (FR-006) means a reader changes only where it reads from, and the existing unit tests' fixtures stay valid.
  - One variable per object, rather than per field, keeps the construct side to one `addEnvironment` call per resource.
  - `core-table` and `search` don't depend on `common-server-utils`. Each reads its one variable (`DISCAVA_DYNAMODB_CORE_TABLE`, `DISCAVA_OPENSEARCH_SEARCH`) by name, and a stack test pins those names to what the constructs set.
- **Alternatives considered**:
  - *One plain variable per field* (`CORE_TABLE_NAME`, `LESSON_MEDIA_BUCKET_NAME`, …): nicer for the two one-field objects, but about 20 names to keep in step and readers rewritten field by field.
  - *Keep `OPENSEARCH_ENDPOINT`*: replaced by `DISCAVA_OPENSEARCH_SEARCH` so there's one rule. Index sync sets the new name. Constitution VII: no alias for the old name.

## R-5: Who sets a setting

- **Decision**:
  - The construct that owns a resource exposes `bindSettings(fn)`, which adds its variable to the function: `CoreTable`, `MediaBucket`, `UploadBucket`, `PublicBucket`, `OpenSearchCollection` and `VideoTranscodePipeline`.
  - The stacks call it wherever they grant on the resource today, replacing `addEnvironment('RUNTIME_CONFIG_APP_ID', …)` and `grantReadAppConfig`.
  - Stack-level objects that aren't a construct's (`mediaConvert.TranscodeCleanup`, `certificates.Reminder`, `captionTranslation.Settings`) are added by the stack that builds them, with the shared name function.
- **Rationale**: This is the same place the grant is made, so a reviewer sees both together, and the stack test (R-7) checks them against each other.

## R-6: Values a function needs about itself

- **Finding**:
  - `certificates.Reminder.lambdaArn` is the reminder function's own ARN. It is read by progress recalculation, which schedules the reminder, not by the reminder itself.
  - `mediaConvert.TranscodeCleanup.lambdaArn` is read by the APIs and by the transcode-outcome handler, which schedule the cleanup. Neither reads its own ARN.
  - So no function reads its own address, and none of these references form a cycle within a resource.
- **Decision**: A task checks this during synth. If a self-reference appears, the ARN is built from a fixed function name instead.

## R-7: Stack tests

- **Decision**:
  - Replace `tableFunctionsMissingAppConfig` (`stack-test-fixture.ts`) with `functionsMissingSettings(template)`. It returns every function whose role policy grants actions on the core table without `DISCAVA_DYNAMODB_CORE_TABLE`, or `aoss:APIAccessAll` on the collection without `DISCAVA_OPENSEARCH_SEARCH`. Each stack test asserts it is empty.
  - For buckets, MediaConvert, schedulers and caption translation, each stack test keeps an explicit table of function → expected variables. A bucket grant alone doesn't mean the function reads the bucket's name: some get it from an S3 event.
  - Add a stage-level test (`application-stage.test.ts`) that:
    - finds no `AWS::AppConfig::*` resource and no `appconfig:` action in any template (after the removal PR);
    - finds no function environment over 4 KB;
    - checks each portal's `runtime-config.json` source matches a snapshot taken before the change.
- **Rationale**:
  - A missing variable on a deployed stage fails only at runtime, and local development never notices, because it uses the `LOCAL_DEV` branches.
  - The test is the gate that replaces the runtime lookup's "every function can read everything".

## R-8: Rolling out to existing stages

- **Decision**: Two kinds of implementation pull request.
  1. **Switch PRs** (one or more) move readers to settings and remove `RUNTIME_CONFIG_APP_ID` and `grantReadAppConfig`. They leave every AppConfig resource and all of its content in place, unread.
  2. **The removal PR** deletes the AppConfig resources and content, and renames the `RuntimeConfig` stack to `PortalConfig`. Before it deploys, an operator deletes the old `RuntimeConfig` stack on each existing stage.
- **Findings**:
  - CloudFormation refuses to delete an export that another stack still imports. Today Data exports the AppConfig application, environment and strategy IDs, and the RuntimeConfig stack imports them for its profiles and deployments. Every consumer stack imports the application ID too.
  - RuntimeConfig's hosted content also imports values that only it uses from Data, MediaPipeline and StreamRouter: scheduler role ARNs, the reminder function ARN, the job template ARN.
  - **Switch PRs**: consumer stacks only drop imports, and dropping an import always succeeds. Data keeps its exports because RuntimeConfig still imports them. Nothing is deleted.
  - **Removal PR without preparation**: Data deploys before RuntimeConfig and would try to delete exports RuntimeConfig still imports, so the deploy fails.
  - Renaming the stack means CDK stops managing `RuntimeConfig` and creates `PortalConfig`. CDK never deletes a stack that has left the app, so the old stack has to be deleted by hand anyway.
  - Deleting the old stack first removes every import of the exports the removal PR drops, so the normal deploy that follows succeeds.
  - The old stack's two `BucketDeployment`s per portal use CDK's default `retainOnDelete: true`, so each portal's `runtime-config.json` stays in its bucket between the deletion and `PortalConfig`'s first deploy. A task confirms the default on the construct.
- **Alternatives considered**:
  - *Keep the name `RuntimeConfig` and run `cdk deploy <stage>/RuntimeConfig --exclusively` before the full deploy*: also one manual step, but the stack keeps a name that no longer describes it.
  - *Removal in two PRs, keeping Data's exports with `this.exportValue(...)` for one release*: no manual step, but it adds temporary code and a third deploy.
- **Rollout steps** (documented in `contracts/rollout.md` and the removal PR):
  1. Re-run `scripts/setup-stage.sh` for each stage before the switch PR that adds the parameter (R-3).
  2. Merge the switch PRs. Each deploys normally.
  3. Before merging the removal PR, delete `<stage>/RuntimeConfig` on each existing stage, then merge. The deploy creates `PortalConfig` and deletes the AppConfig application.
  4. Re-run `scripts/setup-stage.sh` to drop the AppConfig permissions. This is optional, since the removal PR's version no longer grants them.

## R-9: Operator scripts

- **Decision**:
  - Data adds a `CfnOutput` named `CoreTableName`.
  - `seed-categories` and `rebuild-analytics` run against a deployed stage when `DISCAVA_DYNAMODB_CORE_TABLE` is set, and against local dev otherwise, replacing the `RUNTIME_CONFIG_APP_ID` test.
  - `docs/.../deploy/first-deploy.mdx` reads the output with `aws cloudformation describe-stacks` and builds the variable, as it reads `RuntimeConfigApplicationId` today.
- **Rationale**: The scripts use the same `@discava/core-table` resolver the functions use, so they need no code of their own beyond the switch.

## R-10: Settings that default when absent

- **Decision**:
  - Keep the two existing silent fallbacks: `mediaConvert.CaptionLanguageCode`, which defaults to the stage's transcription language, and `captionTranslation.Settings`, which defaults to off.
  - `CaptionLanguageCode` is never published today (no `set` call), so it isn't given at all. Its reader keeps its default, and no stack test expects it.
  - Every other reader throws `Missing deploy-time setting DISCAVA_<…>` on first use.
- **Rationale**: This keeps behaviour identical (FR-004) while making every required setting fail loudly (FR-003).

## R-11: Cold-start effect

- **Finding**: The current readers make one `StartConfigurationSession` plus one `GetLatestConfiguration` call per namespace per instance, which is a network round trip each. Removing them can only shorten the first invocation.
- **Decision**: Don't build a benchmark. A person compares the init duration plus first-invocation duration of one API function before and after on `discava-development` (quickstart step 9).
