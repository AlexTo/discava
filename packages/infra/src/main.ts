/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  App,
  StageIsolationSynthesizer,
  stagePermissionsBoundary,
} from '@discava/common-constructs';
import { listStageNames, resolveStage } from '@discava/common-infra-config';
import { ApplicationStage } from './stages/application-stage.js';

// Per-stage asset prefixes and (in CI) permissions boundaries keep stages that
// share an AWS account from reaching each other's assets and resources; see
// scripts/setup-stage.sh.
const app = new App({
  defaultStackSynthesizer: new StageIsolationSynthesizer(),
});

// Stage configuration (credentials, region, per-component settings) is
// defined in packages/common/infra-config/src/stages.config.ts. Add a stage
// there to deploy it — no changes needed here.
const PROJECT_PATH = 'packages/infra';

for (const stageName of listStageNames(PROJECT_PATH)) {
  const config = resolveStage(PROJECT_PATH, stageName);
  new ApplicationStage(app, stageName, {
    env: {
      account: config?.account ?? process.env.CDK_DEFAULT_ACCOUNT,
      region: config?.region ?? process.env.CDK_DEFAULT_REGION,
    },
    permissionsBoundary: stagePermissionsBoundary(app, stageName),
    ...config?.infra,
    payouts: config?.payouts,
    captionTranslation: config?.captionTranslation,
  });
}

app.synth();
