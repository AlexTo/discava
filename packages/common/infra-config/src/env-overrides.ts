/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { StageComponents, StageConfig } from './stages.types.js';

type FieldKind = 'boolean' | 'string' | 'string[]';

/**
 * Every env-var-overridable field, keyed by component then field name.
 * Kept in sync by hand with `StageComponents` in stages.types.ts (the same
 * way the infra stacks' props already hand-duplicate this field list) --
 * add a line here when a new overridable field is added to a component
 * config type.
 *
 * `credentials` is deliberately not overridable here: unlike these fields,
 * it determines which IAM identity a deploy assumes, which is a bigger,
 * more security-sensitive surface than this override mechanism is meant to
 * cover.
 */
const COMPONENT_FIELDS: Record<
  keyof StageComponents,
  Record<string, FieldKind>
> = {
  identity: {
    enableWaf: 'boolean',
    enableMfa: 'boolean',
    enableDeletionProtection: 'boolean',
    retainOnDelete: 'boolean',
  },
  coreApi: {
    enableWaf: 'boolean',
    enableKmsEncryption: 'boolean',
    enableKeyRotation: 'boolean',
    domainName: 'string',
    certificateArn: 'string',
    retainOnDelete: 'boolean',
  },
  instructorApi: {
    enableWaf: 'boolean',
    enableKmsEncryption: 'boolean',
    enableKeyRotation: 'boolean',
    domainName: 'string',
    certificateArn: 'string',
    retainOnDelete: 'boolean',
  },
  coreTable: {
    enableKmsEncryption: 'boolean',
    enableKeyRotation: 'boolean',
    enableDeletionProtection: 'boolean',
    retainOnDelete: 'boolean',
  },
  studentPortal: {
    enableWaf: 'boolean',
    enableKmsEncryption: 'boolean',
    enableKeyRotation: 'boolean',
    domainNames: 'string[]',
    certificateArn: 'string',
  },
  instructorPortal: {
    enableWaf: 'boolean',
    enableKmsEncryption: 'boolean',
    enableKeyRotation: 'boolean',
    domainNames: 'string[]',
    certificateArn: 'string',
  },
  adminPortal: {
    enableWaf: 'boolean',
    enableKmsEncryption: 'boolean',
    enableKeyRotation: 'boolean',
    domainNames: 'string[]',
    certificateArn: 'string',
  },
  lessonMedia: {
    enableWaf: 'boolean',
    enableKmsEncryption: 'boolean',
    enableKeyRotation: 'boolean',
    retainOnDelete: 'boolean',
    domainNames: 'string[]',
    certificateArn: 'string',
    cookieDomain: 'string',
  },
};

/**
 * Converts a stage name or camelCase identifier into the SCREAMING_SNAKE_CASE
 * segment used in override env var names, e.g. `'studentPortal'` ->
 * `'STUDENT_PORTAL'`, `'discava-development'` -> `'DISCAVA_DEVELOPMENT'`.
 */
// Component settings live under `infra` in a stage's config, so their
// variables carry that segment too: <STAGE>_INFRA_<COMPONENT>_<FIELD>. It
// keeps them apart from any other kind of per-stage setting added beside
// `infra`.
const INFRA_SEGMENT = 'INFRA';

function toEnvSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toUpperCase();
}

function parseEnvValue(
  raw: string,
  kind: FieldKind,
  envKey: string,
): boolean | string | string[] {
  switch (kind) {
    case 'boolean':
      if (raw !== 'true' && raw !== 'false') {
        throw new Error(
          `Invalid value for ${envKey}: expected "true" or "false", got "${raw}"`,
        );
      }
      return raw === 'true';
    case 'string':
      return raw;
    case 'string[]':
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
  }
}

/**
 * Overrides `base` with any matching `<STAGE>_INFRA_<COMPONENT>_<FIELD>` (or
 * `<STAGE>_REGION` / `<STAGE>_ACCOUNT`) environment variables, each segment
 * SCREAMING_SNAKE_CASE. Env overrides take priority over `base`.
 *
 * `@discava/infra`'s `synth` target (packages/infra/project.json) hashes
 * matching env vars into its cache key so a changed override busts the
 * cache -- its grep pattern lists stage names by hand and needs updating
 * alongside any new entry in stages.config.ts.
 */
export function applyEnvOverrides(
  stageName: string,
  base: StageConfig,
): StageConfig {
  const stageSegment = toEnvSegment(stageName);

  const region = process.env[`${stageSegment}_REGION`];
  const account = process.env[`${stageSegment}_ACCOUNT`];

  // Built as a plain record (rather than StageComponents) because TS can't
  // safely narrow a write through a `keyof StageComponents`-indexed access --
  // each component key has its own value type, so `components[component] =`
  // would need to satisfy every possible component type at once. Cast once
  // at the end instead.
  const components: Record<
    string,
    Record<string, boolean | string | string[]>
  > = { ...base.infra };
  for (const [component, fields] of Object.entries(COMPONENT_FIELDS)) {
    const componentSegment = toEnvSegment(component);
    let overrides: Record<string, boolean | string | string[]> | undefined;
    for (const [field, kind] of Object.entries(fields)) {
      const envKey = `${stageSegment}_${INFRA_SEGMENT}_${componentSegment}_${toEnvSegment(field)}`;
      const raw = process.env[envKey];
      if (raw === undefined) continue;
      overrides ??= {};
      overrides[field] = parseEnvValue(raw, kind, envKey);
    }
    if (overrides) {
      components[component] = { ...components[component], ...overrides };
    }
  }

  return {
    ...base,
    ...(region ? { region } : {}),
    ...(account ? { account } : {}),
    ...(Object.keys(components).length
      ? { infra: components as StageComponents }
      : {}),
  };
}
