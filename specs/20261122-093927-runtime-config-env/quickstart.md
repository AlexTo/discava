# Quickstart: Validating Deploy-Time Settings

Steps 1 to 5 run on a branch with no AWS account and no Docker. They are what an implementing agent runs. Steps 6 to 10 are for a person, on `discava-development` after the PRs are deployed ([rollout.md](./contracts/rollout.md)).

## Without AWS

1. **Unit tests for the readers** ([settings-readers.md](./contracts/settings-readers.md)):

   ```sh
   pnpm nx run-many --target test --projects @discava/common-server-utils,@discava/core-table,@discava/search,@discava/core-api,@discava/instructor-api,@discava/events -- --run
   ```

   Expected: each reader returns its setting, fails with `Missing deploy-time setting DISCAVA_…` when a required one is absent, and keeps its default when an optional one is absent.

2. **Stack and construct tests** ([infra-settings.md](./contracts/infra-settings.md)):

   ```sh
   pnpm nx run-many --target test --projects @discava/common-constructs,@discava/infra,@discava/tooling-deploy -- --run
   ```

   Expected: `functionsMissingSettings` is empty for every stack, and each per-function table passes. After the removal PR, no template has `AWS::AppConfig::*` or an `appconfig:` action, the stage has a `PortalConfig` stack and no `RuntimeConfig` stack, and each portal's `runtime-config.json` matches its snapshot.

3. **No reader left:**

   ```sh
   grep -rnE "getAppConfig|resolveAppConfigValue|RUNTIME_CONFIG_APP_ID|OPENSEARCH_ENDPOINT" packages --include=*.ts --exclude-dir=node_modules
   ```

   Expected after phase 2: only the bucket, media, scheduler and caption translation readers. After phase 3: nothing. After the removal PR (phase 4), `grep -rn "aws-appconfig\|appconfig" packages --include=*.ts --exclude-dir=node_modules` finds only the stage test that bans it.

4. **Build, synth and checkov:**

   ```sh
   pnpm build
   ```

   Expected: it passes with no new dependency cycle between stacks.

5. **The e2e suite on PR CI**: unchanged scenarios pass. Local dev doesn't read settings.

## On `discava-development` (human)

6. **Deploy** following [rollout.md](./contracts/rollout.md) for the PR being checked.

7. **Walk each flow** and check the named function's CloudWatch logs for errors containing `deploy-time setting` or `AccessDenied`:

   | Flow | Function(s) |
   |---|---|
   | Sign in to each portal, check `runtime-config.json` loads | pre-token trigger; the portals |
   | Browse and search the catalogue | core-api (table, search) |
   | Open a lesson with a video and play it | core-api (lesson media signing, cookies) |
   | Upload a video and wait until ready with captions | instructor-api (upload bucket, pipeline, cleanup), transcode outcome, transcribe complete, transcode cleanup |
   | Pick a caption language for a course | instructor-api and the caption translation handler (`captionTranslation.Settings`) |
   | Upload a course image | instructor-api (public media bucket) |
   | Finish a course with a certificate | progress recalculation (`certificates.Reminder`) |
   | Open `/learn/<course>` and `/sitemap.xml` signed out | page renderer (parameter) |
   | Stripe test checkout, admin portal | stripe webhook, admin-api |
   | Enrol, post in a discussion | stream router handlers (notifications, search indexing, analytics) |
   | Run `seed-categories` with the documented command | the operator script |

8. **No AppConfig left** (after the removal PR): `aws appconfig list-applications` lists no Discava application, and `aws cloudformation describe-stacks --stack-name discava-development-RuntimeConfig` reports that the stack doesn't exist.

9. **Cold start**: in CloudWatch Logs Insights, compare `@initDuration` plus the first invocation's `@duration` for the core-api handler from the week before against after. It should be no higher.

10. **Cost, the next day:**

    ```sh
    aws ce get-cost-and-usage --time-period Start=<deploy date>,End=<today> --granularity DAILY \
      --metrics UsageQuantity UnblendedCost \
      --filter '{"Dimensions":{"Key":"USAGE_TYPE","Values":["APS2-AppConfig-Deployments","APS2-AppConfig-Requests"]}}' \
      --region us-east-1
    ```

    Expected: no usage after the deploy date (SC-001).
