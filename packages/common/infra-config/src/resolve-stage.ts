/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { applyEnvOverrides } from './env-overrides.js';
import { validatePayoutSettings } from './payout-settings.js';
import stagesConfig from './stages.config.js';
import type { StageConfig, StagesConfig } from './stages.types.js';

// Widen the narrow `as const` type to StagesConfig for dynamic key access
const config: StagesConfig = stagesConfig;

/**
 * Resolves stage config for a given project and stage name.
 * Project-specific fields take priority over shared ones, and both are
 * overridable per field by a `<STAGE>_INFRA_<COMPONENT>_<FIELD>` (or
 * `<STAGE>_REGION` / `<STAGE>_ACCOUNT`) environment variable -- see
 * `applyEnvOverrides` in env-overrides.ts.
 *
 * @param projectPath - Project path relative to workspace root (e.g., 'packages/infra')
 * @param stageName - CDK stage name (e.g., 'my-app-dev')
 * @returns Merged StageConfig or undefined if no config exists for this stage
 */
export function resolveStage(
  projectPath: string,
  stageName: string,
): StageConfig | undefined {
  const shared = config.shared?.stages?.[stageName];
  const project = config.projects?.[projectPath]?.stages?.[stageName];
  if (!shared && !project) return undefined;
  const merged = { ...shared, ...project } as StageConfig;
  if (merged.payouts) validatePayoutSettings(stageName, merged.payouts);
  return applyEnvOverrides(stageName, merged);
}

/**
 * Lists the stage names configured for a given project, so apps can
 * instantiate one CDK Stage per entry instead of hardcoding each stage name.
 *
 * @param projectPath - Project path relative to workspace root (e.g., 'packages/infra')
 * @returns Stage names defined under `projects[projectPath].stages`
 */
export function listStageNames(projectPath: string): string[] {
  return Object.keys(config.projects?.[projectPath]?.stages ?? {});
}
