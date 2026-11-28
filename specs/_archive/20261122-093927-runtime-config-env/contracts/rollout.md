# Contract: Rollout to Existing Stages

Applies to every existing stage (`discava-development`, and `discava-production` if deployed). `deploy.yml` deploys `main` after CI when `AUTO_DEPLOY_STAGE` is set, so each **before merge** step happens before the PR is merged. Research R-8 explains why the steps are needed.

| Step | When | Who | What |
|---|---|---|---|
| 1 | After phase 1 is merged, before merging phase 2 (which adds the page renderer parameter) | Operator with admin credentials | Re-run `scripts/setup-stage.sh <stage>` from `main` for each stage, so the execution role can create `/<stage>/page-renderer` and the boundary lets the renderer read it |
| 2 | Each switch PR (phases 2 and 3) | CI, `deploy.yml` | Normal deploy. Consumer stacks drop their imports of the AppConfig application ID. Data keeps its exports, because `RuntimeConfig` still imports them |
| 3 | After phases 2 and 3 are deployed on a stage | Operator | Confirm nothing reads AppConfig: no function in the stage has `RUNTIME_CONFIG_APP_ID` (`aws lambda list-functions` and the environments), and no role has an `appconfig:` action other than the stage's deploy role |
| 4 | Immediately before merging the removal PR (phase 4) | Operator | Delete the old stack: `aws cloudformation delete-stack --stack-name <stage>-RuntimeConfig` (the stack name `cdk ls` shows), then `aws cloudformation wait stack-delete-complete`. Each portal's `runtime-config.json` stays in its bucket (`retainOnDelete`) |
| 5 | Merge the removal PR | CI, `deploy.yml` | Data deletes the AppConfig application, environment and strategy, which are now unimported. `PortalConfig` is created and rewrites each portal's `runtime-config.json` with the same content |
| 6 | After step 5 | Operator, optional | Re-run `scripts/setup-stage.sh <stage>` to drop the AppConfig rights from the execution role and boundary |

## What can go wrong

- **Step 4 is skipped.** The deploy fails in Data with "Export … cannot be deleted as it is in use by …-RuntimeConfig". CloudFormation rolls back and the stage keeps working on the previous version. Do step 4, then re-run the deploy workflow.
- **Step 1 is skipped.** The deploy fails in Data with an access-denied error on `ssm:PutParameter`. It rolls back, and the stage keeps working. Do step 1, then re-run.
- **Between steps 4 and 5.** The portals keep their retained `runtime-config.json`, and no function reads AppConfig, so users notice nothing.

## Verification after the last step

Follow [quickstart.md](../quickstart.md), steps 6 to 10.
